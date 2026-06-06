import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { MobilityRouteState } from "@/lib/mobilityEngine";

export function mobilityStatesToEnriched(states: MobilityRouteState[]): EnrichedRoute[] {
  return states.map((s) => ({
    routeId: s.id,
    etaMin: s.etaMin,
    modes: s.modes,
    disruptions: s.disruptions,
    instructions: s.instructions,
    steps: s.steps,
    overallScore: s.accessibilityScore,
    signals: {
      accessibility: s.accessibilityScore,
      stress: 100 - s.accessibilityScore,
      reliability: s.disruptions.length === 0 ? 90 : 60,
      predictability: 75,
      crowdingRisk: 30,
    },
    evidence: {
      tfl: s.tflEvidence,
      osm: s.osmEvidence,
      cv: [],
    },
  }));
}
