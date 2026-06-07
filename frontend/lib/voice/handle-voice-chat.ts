import "server-only";

import { serverEnv } from "@/lib/config/env";
import { streamOpenClawReply } from "@/lib/voice/openclaw-client";
import { streamModelReply, type ModelMessage } from "@/lib/voice/model-stream";
import { MarkerStreamParser } from "@/lib/voice/marker-stream";
import {
  roleFrame,
  contentFrame,
  toolCallFrame,
  finishFrames,
  errorFrame,
  type SseFrameMeta,
} from "@/lib/voice/openai-sse";
import { getRouteContext, formatRouteContext } from "@/lib/voice/route-store";
import {
  extractLatestUserText,
  bearerOk,
  resolveSessionId,
  openClawSessionKey,
  buildOpenClawMessage,
  readCookie,
  type OpenAIMessage,
} from "@/lib/voice/voice-chat-helpers";

interface VoiceChatBody {
  messages?: OpenAIMessage[];
  user?: string;
  stream?: boolean;
}

// Voice persona for the direct-model backend (the OpenClaw backend gets this
// from its workspace SOUL.md instead).
const VOICE_SYSTEM_PROMPT = [
  "You are Layla, a real-time VOICE guide for getting around London, with special care for accessibility and mobility needs.",
  "Answer immediately and directly — lead with the answer, no preamble, no thinking out loud.",
  "Maximum 2 short sentences. Spoken English only: no markdown, lists, headings, code, or emojis.",
  "No filler ('great question', 'certainly', 'of course'). If you don't know, say so in one sentence.",
  "When the user asks to see a route or place, emit one map command on its own line BEFORE your spoken sentence, then speak normally:",
  '[[MAPCMD{"command":"show_routes","from":"<origin>","to":"<destination>"}MAPCMD]]',
  "The user never hears that marker — it updates the map.",
].join("\n");

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** Build the message list for the direct-model backend: our system persona
 * (+ route context) followed by the conversation history from ElevenLabs. */
function buildModelMessages(body: VoiceChatBody, routeContextText: string): ModelMessage[] {
  const sys =
    routeContextText && routeContextText !== "No active route on the map yet."
      ? `${VOICE_SYSTEM_PROMPT}\n\n[Current map context]\n${routeContextText}`
      : VOICE_SYSTEM_PROMPT;
  const history: ModelMessage[] = (body.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as string, content: messageText(m.content) }))
    .filter((m) => m.content);
  return [{ role: "system", content: sys }, ...history];
}

/**
 * ElevenLabs Conversational AI "Custom LLM" endpoint, mounted at
 * /api/voice/chat and /chat/completions. Streams a reply back as OpenAI SSE.
 * Two backends (serverEnv.voice.backend):
 *   - "model": stream straight from the fast model on :8000 (low latency).
 *   - "openclaw": route through the OpenClaw agent (tools/memory, higher latency).
 * Map intents emitted as [[MAPCMD..]] markers are stripped from speech and
 * surfaced as OpenAI tool_calls for ElevenLabs client tools.
 */
export async function handleVoiceChat(req: Request): Promise<Response> {
  if (!bearerOk(req.headers.get("authorization"), serverEnv.voice.chatSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: VoiceChatBody;
  try {
    body = (await req.json()) as VoiceChatBody;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (process.env.VOICE_DEBUG === "1") {
    const roles = (body.messages ?? []).map((m) => m.role).join(",");
    const preview = (body.messages ?? [])
      .slice(-3)
      .map((m) => `${m.role}:${messageText(m.content).slice(0, 60)}`)
      .join(" | ");
    console.error(
      `[voice/debug] IN auth=${Boolean(req.headers.get("authorization"))} stream=${body.stream} nmsg=${(body.messages ?? []).length} roles=[${roles}] last=${preview}`,
    );
  }

  const userText = extractLatestUserText(body.messages);
  if (!userText) {
    if (process.env.VOICE_DEBUG === "1") console.error("[voice/debug] 400 no user message");
    return new Response("No user message", { status: 400 });
  }

  const useModel = serverEnv.voice.backend === "model";
  if (!useModel && (!serverEnv.openclaw.enabled || !serverEnv.openclaw.gatewayToken)) {
    return new Response("OpenClaw gateway not configured", { status: 503 });
  }

  const sessionId = resolveSessionId({
    headerSessionId: req.headers.get("x-session-id"),
    bodyUser: typeof body.user === "string" ? body.user : null,
    cookieSessionId: readCookie(req.headers.get("cookie"), "session_id"),
  });
  const routeContextText = formatRouteContext(getRouteContext(sessionId));

  const meta: SseFrameMeta = {
    id: `chatcmpl-${globalThis.crypto.randomUUID()}`,
    model: useModel ? serverEnv.voice.model : serverEnv.openclaw.model,
    created: Math.floor(Date.now() / 1000),
  };

  const encoder = new TextEncoder();
  const parser = new MarkerStreamParser();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const t0 = Date.now();
  const debug = process.env.VOICE_DEBUG === "1";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let contentChars = 0;
      let firstContentMs = -1;
      const send = (s: string) => {
        if (s && !closed) controller.enqueue(encoder.encode(s));
      };
      let toolIndex = 0;
      const onIncrement = (text: string) => {
        const { speech, commands } = parser.push(text);
        if (speech) {
          if (firstContentMs < 0) firstContentMs = Date.now() - t0;
          contentChars += speech.length;
          send(contentFrame(meta, speech));
        }
        for (const c of commands) send(toolCallFrame(meta, c, toolIndex++));
      };
      if (debug) {
        req.signal.addEventListener(
          "abort",
          () =>
            console.error(
              `[voice/debug] ABORT after ${Date.now() - t0}ms firstContent=${firstContentMs}ms sentChars=${contentChars}`,
            ),
          { once: true },
        );
      }

      send(roleFrame(meta));

      try {
        if (useModel) {
          await streamModelReply({
            baseUrl: serverEnv.voice.modelUrl,
            model: serverEnv.voice.model,
            messages: buildModelMessages(body, routeContextText),
            maxTokens: serverEnv.voice.modelMaxTokens,
            signal: ac.signal,
            onIncrement,
          });
        } else {
          await streamOpenClawReply({
            gatewayUrl: serverEnv.openclaw.gatewayUrl,
            token: serverEnv.openclaw.gatewayToken,
            sessionKey: openClawSessionKey(sessionId),
            message: buildOpenClawMessage(userText, routeContextText),
            signal: ac.signal,
            onIncrement,
          });
        }

        const tail = parser.flush();
        if (tail.speech) send(contentFrame(meta, tail.speech));
        for (const c of tail.commands) send(toolCallFrame(meta, c, toolIndex++));
        send(finishFrames(meta, "stop"));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[voice/chat] stream error:", detail);
        if (!closed) send(errorFrame(meta, "Sorry, I could not reach the assistant just now."));
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
