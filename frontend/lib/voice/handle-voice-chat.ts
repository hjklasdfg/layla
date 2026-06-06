import "server-only";

import { serverEnv } from "@/lib/config/env";
import { streamOpenClawReply } from "@/lib/voice/openclaw-client";
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

/**
 * Shared handler for the ElevenLabs Conversational AI "Custom LLM" endpoint.
 * Mounted at BOTH `/api/voice/chat` (internal) and `/chat/completions` (the
 * path ElevenLabs derives from the base tunnel URL + Chat Completions type).
 *
 * Bridges an OpenAI chat-completions streaming request to the OpenClaw agent
 * and streams the reply back as OpenAI SSE. Map intents the agent emits as
 * [[MAPCMD..MAPCMD]] markers are stripped from speech and surfaced as OpenAI
 * tool_calls (-> ElevenLabs client tools update the Leaflet map).
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

  const userText = extractLatestUserText(body.messages);
  if (!userText) return new Response("No user message", { status: 400 });

  if (!serverEnv.openclaw.enabled || !serverEnv.openclaw.gatewayToken) {
    return new Response("OpenClaw gateway not configured", { status: 503 });
  }

  const sessionId = resolveSessionId({
    headerSessionId: req.headers.get("x-session-id"),
    bodyUser: typeof body.user === "string" ? body.user : null,
    cookieSessionId: readCookie(req.headers.get("cookie"), "session_id"),
  });
  const sessionKey = openClawSessionKey(sessionId);
  const routeContextText = formatRouteContext(getRouteContext(sessionId));
  const message = buildOpenClawMessage(userText, routeContextText);

  const meta: SseFrameMeta = {
    id: `chatcmpl-${globalThis.crypto.randomUUID()}`,
    model: serverEnv.openclaw.model,
    created: Math.floor(Date.now() / 1000),
  };

  const encoder = new TextEncoder();
  const parser = new MarkerStreamParser();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (s && !closed) controller.enqueue(encoder.encode(s));
      };
      let toolIndex = 0;

      send(roleFrame(meta));

      try {
        await streamOpenClawReply({
          gatewayUrl: serverEnv.openclaw.gatewayUrl,
          token: serverEnv.openclaw.gatewayToken,
          sessionKey,
          message,
          signal: ac.signal,
          onIncrement: (text) => {
            const { speech, commands } = parser.push(text);
            if (speech) send(contentFrame(meta, speech));
            for (const c of commands) send(toolCallFrame(meta, c, toolIndex++));
          },
        });

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
