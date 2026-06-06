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

export interface EnrichedRoute {
  routeId: string;
  name: string;
  etaMin: number;
  signals: AccessibilitySignals;
  evidence: RouteEvidence;
  risks: string[];
  strengths: string[];
  steps?: JourneyStep[];
  transferCount?: number;
  walkingMinutes?: number;
  additionalWaitMin?: number;
  plannedEtaMin?: number;
}
