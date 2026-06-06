import type { JourneyStep } from "@/services/tfl/types";

export interface AccessibilitySignals {
  accessibility: number;
  stress: number;
  reliability: number;
  predictability: number;
  crowding: number;
  crossingComplexity: number;
}

export interface RouteEvidence {
  tfl: string[];
  osm: string[];
  cv: string[];
}

/** Layla's 5 layered signals (0–100, higher is better), one per data layer. */
export interface RouteSignals5 {
  accessibility: number;
  safety: number;
  quiet: number;
  lighting: number;
  air: number;
}

export interface EnrichedRoute {
  routeId: string;
  name: string;
  etaMin: number;
  signals: AccessibilitySignals;
  /** Present for layla-routing routes; the card shows these 5 instead of the 6 above. */
  signals5?: RouteSignals5;
  evidence: RouteEvidence;
  risks: string[];
  strengths: string[];
  steps?: JourneyStep[];
  transferCount?: number;
  walkingMinutes?: number;
  additionalWaitMin?: number;
  plannedEtaMin?: number;
}
