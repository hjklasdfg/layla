import "server-only";

import { buildTflDataPayload } from "@/lib/mobility/build-tfl-payload";
import type { GpsLocation } from "@/lib/mobility/sensors";
import { serverEnv } from "@/lib/config/env";
import {
  parseRecommendationPayload,
  type AgentProvider,
  type MobilityAgentContext,
  type MobilityRecommendation,
} from "../types";

function buildBackendRequestBody(context: MobilityAgentContext) {
  const { journey, preference, routes, sensors } = context;

  return {
    audioInput: sensors?.audioInput,
    gps: sensors?.gps ?? null,
    cameraData: sensors?.cameraData ?? [],
    preference,
    journey,
    tflData:
      sensors?.tflData ??
      buildTflDataPayload(journey.start, journey.destination, preference.profile, routes),
    routes,
  };
}

export class BackendProvider implements AgentProvider {
  async recommend(context: MobilityAgentContext): Promise<MobilityRecommendation> {
    if (!serverEnv.backend.enabled) {
      throw new Error("BACKEND_API_URL not configured");
    }

    const url = `${serverEnv.backend.apiUrl.replace(/\/$/, "")}/mobility/recommend`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serverEnv.backend.apiKey
          ? { Authorization: `Bearer ${serverEnv.backend.apiKey}` }
          : {}),
      },
      body: JSON.stringify(buildBackendRequestBody(context)),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Backend error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const recommendationSource =
      typeof data.recommendation === "object" && data.recommendation
        ? (data.recommendation as Record<string, unknown>)
        : data;

    const parsed = parseRecommendationPayload(JSON.stringify(recommendationSource));
    return { provider: "backend", ...parsed };
  }
}

export async function fetchBackendJourneyIntent(
  audioInput: string,
  gps?: GpsLocation | null
): Promise<{ start?: string; destination?: string }> {
  if (!serverEnv.backend.enabled) {
    return {};
  }

  const url = `${serverEnv.backend.apiUrl.replace(/\/$/, "")}/mobility/intent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(serverEnv.backend.apiKey
        ? { Authorization: `Bearer ${serverEnv.backend.apiKey}` }
        : {}),
    },
    body: JSON.stringify({ audioInput, gps: gps ?? null }),
  });

  if (!res.ok) {
    return {};
  }

  const data = (await res.json()) as { start?: string; destination?: string; from?: string; to?: string };
  return {
    start: data.start ?? data.from,
    destination: data.destination ?? data.to,
  };
}
