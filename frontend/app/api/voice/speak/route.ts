import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env";

export async function POST(request: Request) {
  const body = (await request.json()) as { text?: string };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (!serverEnv.elevenlabs.apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 503 }
    );
  }

  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb";

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": serverEnv.elevenlabs.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: body.text.trim(),
        model_id:
          process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_multilingual_v2",
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: detail || "ElevenLabs TTS failed" },
      { status: res.status }
    );
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
