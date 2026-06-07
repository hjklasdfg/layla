import { handleVoiceChat } from "@/lib/voice/handle-voice-chat";

// ElevenLabs Conversational AI "Custom LLM" (Chat Completions type) derives the
// endpoint as <base URL>/chat/completions. With the tunnel base set to
// https://layla.ai-cloud.io/ it POSTs here. Same adapter as /api/voice/chat.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return handleVoiceChat(req);
}
