import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import type { RouteExplanation } from "@/lib/mobility/backend-plan-types";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import type { MobilityRouteState } from "@/lib/mobilityEngine";
import type { CameraDataItem, GpsLocation } from "@/lib/mobility/sensors";

export interface MobilityPlanRequest {
  audioInput?: string;
  gps?: GpsLocation | null;
  cameraData?: CameraDataItem[];
  preference: UserPreference;
  journey?: {
    start?: string;
    destination?: string;
  };
}

export interface MobilityPlanResponse {
  journey: { start: string; destination: string };
  routes: MobilityRouteState[];
  enrichedRoutes: EnrichedRoute[];
  recommendation: MobilityRecommendation;
  explanation: RouteExplanation;
  meta: {
    source: "backend" | "local";
    from: string;
    to: string;
    count: number;
    profile: UserPreference["profile"];
    osmWarning?: string;
    llmInput?: LlmPlanInput;
    /** @deprecated use llmInput */
    geminiInput?: LlmPlanInput;
  };
}

export type { RouteExplanation };

export async function planMobilityJourney(
  request: MobilityPlanRequest
): Promise<MobilityPlanResponse> {
  const res = await fetch("/api/mobility/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const data = (await res.json()) as MobilityPlanResponse & { error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? `Mobility plan failed (${res.status})`);
  }

  return data;
}
