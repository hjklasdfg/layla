import { NextResponse } from "next/server";

import { ensureCameraHazardServer } from "@/lib/camera/hazard-server-launcher";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 120;

export async function POST() {
  if (serverEnv.cameraHazard.fakeLoop) {
    return NextResponse.json({
      ok: true,
      ready: true,
      started: false,
      demo: false,
      mode: "fake-loop",
      url: "local",
      message: "Loop test mode — real camera chunks, faked hazard responses.",
    });
  }

  if (!serverEnv.cameraHazard.apiUrl) {
    return NextResponse.json(
      {
        error:
          "Set CAMERA_HAZARD_FAKE_LOOP=true for loop test, or CAMERA_HAZARD_API_URL for real inference.",
      },
      { status: 503 }
    );
  }

  try {
    const status = await ensureCameraHazardServer();
    return NextResponse.json({
      ok: true,
      ...status,
      message: status.started
        ? `Started camera-hazard service (${status.mode} mode).`
        : `Camera-hazard service already running (${status.mode} mode).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start hazard service";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
