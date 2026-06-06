import "server-only";

import { randomUUID } from "node:crypto";

/**
 * Client for the OpenClaw gateway WebSocket RPC (protocol 4), verified against a
 * live gateway (server 2026.5.x):
 *
 *   open ws -> req "connect" {auth:{token}} -> res hello-ok
 *           -> req "chat.send" {sessionKey, message, deliver:false, idempotencyKey} -> {runId}
 *           -> event "agent" {runId, stream:"lifecycle", data:{phase:"start"}}
 *           -> event "agent" {runId, stream:"assistant", data:{text, delta}}   <-- spoken text
 *           -> event "agent" {runId, stream:"tool"|"reasoning"|...}            <-- NOT spoken
 *           -> event "agent" {runId, stream:"lifecycle", data:{phase:"end"}}
 *
 * Why the agent stream and not the `chat` stream: the OpenClaw agent is
 * multi-step (it can call tools and emit several assistant segments per turn),
 * so there is no single "final" event — there can be several. We therefore:
 *   - stream only `stream:"assistant"` deltas (reasoning rides other streams,
 *     so it is never spoken);
 *   - treat the turn as complete after a quiet "settle" window following the
 *     last lifecycle `end` with no further activity (debounce);
 *   - correlate strictly by the chat.send runId.
 *
 * One connection per turn (pooling is a deferred latency optimization).
 */

export interface StreamReplyOptions {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  message: string;
  /** Called with each new speakable increment as it streams. */
  onIncrement: (text: string) => void;
  signal?: AbortSignal;
  /** Whole-turn timeout backstop. */
  timeoutMs?: number;
  /** Max wait for the first spoken token before giving up. */
  firstTokenTimeoutMs?: number;
  /** Quiet window after the last activity that marks end-of-turn. */
  settleMs?: number;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class GatewayError extends Error {}

export async function streamOpenClawReply(opts: StreamReplyOptions): Promise<void> {
  const {
    gatewayUrl,
    token,
    sessionKey,
    message,
    onIncrement,
    signal,
    timeoutMs = 90_000,
    firstTokenTimeoutMs = 45_000,
    settleMs = 1_500,
  } = opts;

  let ws: WebSocket;
  try {
    ws = new WebSocket(gatewayUrl, {
      headers: { Origin: new URL(gatewayUrl).origin.replace(/^ws/, "http") },
    } as unknown as string[]);
  } catch {
    ws = new WebSocket(gatewayUrl);
  }

  const pending = new Map<string, Pending>();
  let reqId = 0;
  let settled = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let firstTokenTimer: ReturnType<typeof setTimeout> | undefined;

  const track = (t: ReturnType<typeof setTimeout>) => {
    timers.add(t);
    return t;
  };

  const cleanup = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new GatewayError("connection closed"));
    }
    pending.clear();
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  return new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    function onAbort() {
      finish(new GatewayError("aborted"));
    }

    if (signal) {
      if (signal.aborted) return finish(new GatewayError("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
    }

    track(setTimeout(() => finish(new GatewayError("turn timed out")), timeoutMs));

    const request = (method: string, params: Record<string, unknown>, ms = 30_000) => {
      const id = `r${++reqId}`;
      ws.send(JSON.stringify({ type: "req", id, method, params }));
      return new Promise<Record<string, unknown>>((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new GatewayError(`timeout waiting for ${method}`));
        }, ms);
        pending.set(id, { resolve: res, reject: rej, timer });
      });
    };

    let runId: string | undefined;
    let gotFirst = false;

    const armSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = track(setTimeout(() => finish(), settleMs));
    };
    const cancelSettle = () => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
    };

    const handleAgentEvent = (payload: Record<string, unknown>) => {
      const stream = payload.stream as string | undefined;
      const data = (payload.data ?? {}) as { delta?: unknown; phase?: string };

      if (stream === "assistant") {
        cancelSettle(); // text still flowing
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (delta) {
          gotFirst = true;
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
          try {
            onIncrement(delta);
          } catch {
            /* downstream closed */
          }
        }
        return;
      }

      if (stream === "lifecycle") {
        if (data.phase === "start") cancelSettle();
        else if (data.phase === "end") armSettle();
        return;
      }

      // tool / item / reasoning / other: agent is still working — do not speak,
      // and keep the turn open.
      cancelSettle();
    };

    ws.addEventListener("message", (ev) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String((ev as { data: unknown }).data));
      } catch {
        return;
      }

      if (frame.type === "res" && typeof frame.id === "string" && pending.has(frame.id)) {
        const p = pending.get(frame.id)!;
        pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok === false || frame.error) {
          p.reject(new GatewayError(JSON.stringify(frame.error ?? frame)));
        } else {
          p.resolve((frame.payload ?? frame.result ?? frame) as Record<string, unknown>);
        }
        return;
      }

      if (process.env.OPENCLAW_DEBUG) {
        console.error("[oc<-]", JSON.stringify(frame).slice(0, 200));
      }

      if (frame.event === "agent") {
        const payload = (frame.payload ?? {}) as Record<string, unknown>;
        if (payload.errorMessage) return finish(new GatewayError(String(payload.errorMessage)));
        // Correlate strictly to our turn once the runId is known.
        if (runId && payload.runId && payload.runId !== runId) return;
        handleAgentEvent(payload);
      }
    });

    ws.addEventListener("error", () => finish(new GatewayError("gateway socket error")));
    ws.addEventListener("close", () => {
      if (!settled) finish(new GatewayError("gateway closed connection"));
    });

    ws.addEventListener("open", async () => {
      try {
        await request("connect", {
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: "openclaw-control-ui",
            displayName: "layla-voice-adapter",
            version: "1",
            platform: process.platform,
            mode: "ui",
            instanceId: randomUUID(),
          },
          caps: ["tool-events"],
          scopes: ["operator.read", "operator.write"],
          auth: { token },
        });

        firstTokenTimer = track(
          setTimeout(() => {
            if (!gotFirst) finish(new GatewayError("agent produced no output (first-token timeout)"));
          }, firstTokenTimeoutMs),
        );

        const idempotencyKey = randomUUID();
        const sendRes = await request(
          "chat.send",
          { sessionKey, message, deliver: false, timeoutMs, idempotencyKey },
          timeoutMs,
        );
        runId = (sendRes.runId as string) ?? idempotencyKey;
      } catch (err) {
        finish(err instanceof Error ? err : new GatewayError(String(err)));
      }
    });
  });
}
