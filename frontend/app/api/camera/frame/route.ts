import { NextResponse } from "next/server";

import { buildFakeHazardResponse } from "@/lib/camera/hazard-fake-response";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const frame = formData.get("frame");

    if (!(frame instanceof Blob)) {
      return NextResponse.json({ error: "frame is required" }, { status: 400 });
    }

    const frameIndexRaw =
      formData.get("frameIndex")?.toString() ??
      formData.get("chunkIndex")?.toString() ??
      "0";
    const frameIndex = Number.parseInt(frameIndexRaw, 10);
    const safeIndex = Number.isFinite(frameIndex) ? frameIndex : 0;
    const timestamp = formData.get("timestamp")?.toString() ?? new Date().toISOString();
    const gpsRaw = formData.get("gps")?.toString();

    if (serverEnv.cameraHazard.fakeLoop) {
      const fake = buildFakeHazardResponse(safeIndex, frame.size);
      return NextResponse.json({
        ...fake,
        frameIndex: safeIndex,
        forwarded: false,
        faked: true,
        message: `Loop test: frame ${safeIndex} received (${frame.size} bytes).`,
        timestamp,
        gpsReceived: Boolean(gpsRaw),
      });
    }

    if (serverEnv.cameraHazard.apiUrl) {
      const backendForm = new FormData();
      backendForm.append("frame", frame, `camera-frame-${safeIndex}.jpg`);
      backendForm.append("frameIndex", String(safeIndex));
      backendForm.append("timestamp", timestamp);
      if (gpsRaw) backendForm.append("gps", gpsRaw);

      const res = await fetch(
        `${serverEnv.cameraHazard.apiUrl.replace(/\/$/, "")}/camera/frame`,
        {
          method: "POST",
          headers: serverEnv.cameraHazard.apiKey
            ? { Authorization: `Bearer ${serverEnv.cameraHazard.apiKey}` }
            : undefined,
          body: backendForm,
        }
      );

      if (!res.ok) {
        const message = await res.text();
        return NextResponse.json(
          { error: message || "Backend camera frame upload failed" },
          { status: res.status }
        );
      }

      const payload = (await res.json()) as Record<string, unknown>;
      return NextResponse.json({ ok: true, forwarded: true, ...payload });
    }

    return NextResponse.json({
      ok: true,
      forwarded: false,
      message:
        "Frame received. Set CAMERA_HAZARD_FAKE_LOOP=true for loop test, or CAMERA_HAZARD_API_URL for real inference.",
      frameIndex: safeIndex,
      bytes: frame.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Camera frame upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
