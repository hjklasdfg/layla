import type { JourneyStep } from "@/services/tfl/types";

export interface AccessibilitySignals {
  accessibility: number;
  stress: number;
  reliability: number;
  predictability: number;
  crowdingRisk: number;
}

export interface EnrichedRoute {
  routeId: string;
  etaMin: number;
  modes: string[];
  disruptions: string[];
  instructions: string[];
  steps: JourneyStep[];
  signals: AccessibilitySignals;
  overallScore: number;
  evidence: {
    tfl: string[];
    osm: string[];
    cv: string[];
  };
}
