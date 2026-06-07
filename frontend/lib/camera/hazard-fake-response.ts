import type { HazardStreamResult } from "@/lib/camera/hazard-stream";
import { describeSurroundings, hazardCarefulVoiceText } from "@/lib/camera/surroundings";

/** Frame index (0-based) at which the fake close hazard appears. Default: 30 (~9s at 300ms). */
function hazardAtFrame(): number {
  const fromFrame = Number(process.env.CAMERA_HAZARD_FAKE_AT_FRAME);
  if (Number.isFinite(fromFrame) && fromFrame >= 0) return fromFrame;
  const fromChunk = Number(process.env.CAMERA_HAZARD_FAKE_AT_CHUNK ?? "30");
  return Number.isFinite(fromChunk) && fromChunk >= 0 ? fromChunk : 30;
}

export function buildFakeHazardResponse(
  frameIndex: number,
  bytes: number
): HazardStreamResult {
  const triggerAt = hazardAtFrame();
  const frameWidth = 1280;
  const frameHeight = 720;

  if (frameIndex < triggerAt) {
    const hazards =
      frameIndex === 0
        ? []
        : [
            {
              label: "test cone (far)",
              bbox: { x1: 0.12, y1: 0.08, x2: 0.28, y2: 0.22 },
              proximity: 0.35,
            },
          ];

    return {
      ok: true,
      chunkIndex: frameIndex,
      bytes,
      frameWidth,
      frameHeight,
      hazards,
      action: "continue",
      voiceText: null,
      closestHazard: hazards[0] ?? null,
      surroundings: describeSurroundings(hazards),
      meta: {
        model: "fake/loop-test",
        inferenceMs: 50,
        hazardCount: hazards.length,
        stopThreshold: 0.9,
      },
    };
  }

  const closeHazard = {
    label: "test pothole (close)",
    bbox: { x1: 0.32, y1: 0.52, x2: 0.68, y2: 0.88 },
    proximity: 0.92,
  };
  const surroundings = describeSurroundings([closeHazard]);

  return {
    ok: true,
    chunkIndex: frameIndex,
    bytes,
    frameWidth,
    frameHeight,
    hazards: [closeHazard],
    action: "stop",
    voiceText: surroundings.voiceText,
    closestHazard: closeHazard,
    surroundings,
    meta: {
      model: "fake/loop-test",
      inferenceMs: 50,
      hazardCount: 1,
      stopThreshold: 0.9,
    },
  };
}
