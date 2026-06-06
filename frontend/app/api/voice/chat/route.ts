import { verifyElevenLabsSignature } from "@/lib/voice/auth";
import { loadMemory, extractAndSaveMemory } from "@/lib/voice/memory";
import { buildSystemPrompt } from "@/lib/voice/context-builder";
import { RouteStore } from "@/lib/voice/route-store";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 30;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface VoiceChatRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

function getSessionId(req: Request): string {
  const header = req.headers.get("x-session-id");
  if (header) return header;

  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session_id=([^;]+)/);
  if (match) return match[1];

  return "default";
}

function extractTextFromSSEChunk(chunk: string): string {
  const lines = chunk.split("\n");
  let text = "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      text += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      // malformed chunk — skip
    }
  }
  return text;
}

export async function POST(req: Request): Promise<Response> {
  // 1. Verify ElevenLabs signature (skip when secret not configured — dev mode)
  if (serverEnv.elevenlabs.apiKey) {
    const signature = req.headers.get("elevenlabs-signature");
    const bodyText = await req.clone().text();
    const valid = await verifyElevenLabsSignature(
      bodyText,
      signature,
      serverEnv.elevenlabs.apiKey
    );
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 2. Parse request
  let body: VoiceChatRequest;
  try {
    body = (await req.json()) as VoiceChatRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.messages?.length) {
    return new Response("messages is required", { status: 400 });
  }

  const sessionId = getSessionId(req);

  // 3. Load context
  const memory = await loadMemory(sessionId);
  const routeContext = RouteStore.get(sessionId) ?? null;

  // 4. Build enriched system prompt
  const systemMessage = buildSystemPrompt(memory, routeContext);

  // 5. Filter ElevenLabs system messages, prepend ours
  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    ...body.messages.filter((m) => m.role !== "system"),
  ];

  // 6. Forward to NemoClaw
  let nemoclawRes: Response;
  try {
    nemoclawRes = await fetch(
      `${serverEnv.nemoclaw.inferenceUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.nemoclaw.apiKey}`,
        },
        body: JSON.stringify({
          model: serverEnv.nemoclaw.model,
          messages,
          stream: true,
          temperature: body.temperature ?? 0.4,
          max_tokens: body.max_tokens ?? 256,
        }),
      }
    );
  } catch {
    return new Response("Inference unavailable", { status: 503 });
  }

  if (!nemoclawRes.ok) {
    return new Response("Inference unavailable", { status: 503 });
  }

  if (!nemoclawRes.body) {
    return new Response("Empty inference response", { status: 503 });
  }

  // 7. Pipe stream, accumulate for post-turn memory write-back
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let fullResponse = "";

  const upstream = nemoclawRes.body;
  (async () => {
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResponse += extractTextFromSSEChunk(decoder.decode(value, { stream: true }));
        await writer.write(value);
      }
    } finally {
      await writer.close().catch(() => {});
    }

    // 8. Post-turn: extract + save memory (fire-and-forget)
    extractAndSaveMemory(sessionId, body.messages, fullResponse).catch(
      () => {}
    );
  })().catch(() => {
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
