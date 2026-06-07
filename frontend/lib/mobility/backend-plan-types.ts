import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import type { UserPreference } from "@/lib/agent/types";
import type { CameraDataItem, GpsLocation } from "@/lib/mobility/sensors";
import type { RouteCandidate } from "@/services/tfl/types";

/** Payload the frontend sends to the backend for full mobility planning. */
export interface BackendMobilityPlanRequest {
  audioInput?: string;
  gps?: GpsLocation | null;
  cameraData?: CameraDataItem[];
  preference: UserPreference;
  journey: {
    start: string;
    destination: string;
  };
  /** Raw TfL Journey API output — OSM enrichment happens on the backend. */
  tflJourney: {
    from: string;
    to: string;
    candidates: RouteCandidate[];
  };
  /** Geocoded journey endpoints for map path validation. */
  journeyAnchors?: JourneyAnchorPoints;
}

export interface JourneyMapPoint {
  lat: number;
  lng: number;
  name: string;
}

export interface JourneyAnchorPoints {
  start?: JourneyMapPoint | null;
  end?: JourneyMapPoint | null;
  maxEndpointDriftKm?: number;
}

export interface RouteExplanation {
  /** Longer markdown-friendly copy for the UI panel. */
  uiText: string;
  /** Spoken copy from backend — ElevenLabs reads this verbatim, then stays conversational. */
  voiceText: string;
}

export interface BackendMobilityPlanResponse {
  journey: { start: string; destination: string };
  routes: import("@/lib/mobilityEngine").MobilityRouteState[];
  enrichedRoutes: import("@/lib/accessibility/types").EnrichedRoute[];
  recommendation: import("@/lib/agent/types").MobilityRecommendation;
  explanation: RouteExplanation;
  meta: {
    source: "backend" | "local";
    from: string;
    to: string;
    count: number;
    profile: UserPreference["profile"];
    osmWarning?: string;
    /** Geocoded from user journey labels — use for map A/B pins. */
    startPoint?: JourneyMapPoint;
    endPoint?: JourneyMapPoint;
    llmInput?: LlmPlanInput;
    /** @deprecated use llmInput */
    geminiInput?: LlmPlanInput;
  };
}

export function buildTflJourneyPayload(
  from: string,
  to: string,
  candidates: RouteCandidate[]
): BackendMobilityPlanRequest["tflJourney"] {
  return {
    from,
    to,
    candidates,
  };
}
