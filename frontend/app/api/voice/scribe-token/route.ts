import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env";

/** Single-use token for ElevenLabs Scribe — continuous STT without a conversational agent. */
export async function GET() {
  if (!serverEnv.elevenlabs.apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 503 }
    );
  }

  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: { "xi-api-key": serverEnv.elevenlabs.apiKey },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: message || "Failed to get Scribe token" },
      { status: response.status }
    );
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    return NextResponse.json({ error: "Scribe token missing in response" }, { status: 502 });
  }

  return NextResponse.json({ token: data.token });
}
