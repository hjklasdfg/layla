import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env";

export async function GET(request: NextRequest) {
  const { apiKey, agentId } = serverEnv.elevenlabs;

  if (!apiKey || !agentId) {
    return NextResponse.json({ signedUrl: null });
  }

  const userId = request.nextUrl.searchParams.get("userId")?.trim();

  const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get_signed_url");
  url.searchParams.set("agent_id", agentId);

  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: message || "Failed to get ElevenLabs signed URL" },
      { status: response.status }
    );
  }

  const data = (await response.json()) as { signed_url?: string };
  return NextResponse.json({
    signedUrl: data.signed_url ?? null,
    userId: userId ?? null,
  });
}
