import { handleVoiceChat } from "@/lib/voice/handle-voice-chat";

// Node runtime (opens a localhost WebSocket to the OpenClaw gateway);
// force-dynamic so the SSE stream is never cached/prerendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleVoiceChat(req);
}
