import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk");

    if (!(chunk instanceof Blob)) {
      return NextResponse.json({ error: "chunk is required" }, { status: 400 });
    }

    const chunkIndex = formData.get("chunkIndex")?.toString() ?? "0";
    const timestamp = formData.get("timestamp")?.toString() ?? new Date().toISOString();
    const gpsRaw = formData.get("gps")?.toString();

    if (serverEnv.backend.enabled) {
      const backendForm = new FormData();
      backendForm.append("chunk", chunk, `camera-chunk-${chunkIndex}.webm`);
      backendForm.append("chunkIndex", chunkIndex);
      backendForm.append("timestamp", timestamp);
      if (gpsRaw) backendForm.append("gps", gpsRaw);

      const res = await fetch(
        `${serverEnv.backend.apiUrl.replace(/\/$/, "")}/camera/stream`,
        {
          method: "POST",
          headers: serverEnv.backend.apiKey
            ? { Authorization: `Bearer ${serverEnv.backend.apiKey}` }
            : undefined,
          body: backendForm,
        }
      );

      if (!res.ok) {
        const message = await res.text();
        return NextResponse.json(
          { error: message || "Backend camera upload failed" },
          { status: res.status }
        );
      }

      const payload = (await res.json()) as Record<string, unknown>;
      return NextResponse.json({ ok: true, forwarded: true, ...payload });
    }

    return NextResponse.json({
      ok: true,
      forwarded: false,
      message: "Chunk received locally. Set BACKEND_API_URL to forward camera stream.",
      chunkIndex,
      bytes: chunk.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Camera upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
