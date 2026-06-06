import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { MobilityRouteState } from "@/lib/mobilityEngine";

export function mobilityStatesToEnriched(
  states: MobilityRouteState[]
): EnrichedRoute[] {
  return states.map((state) => ({
    routeId: state.id,
    name: state.name,
    etaMin: state.etaMin,
    signals: state.signals,
    evidence: state.evidence,
    risks: state.risks,
    strengths: state.strengths,
    steps: state.steps,
    transferCount: state.transferCount,
    walkingMinutes: state.walkingMinutes,
    additionalWaitMin: state.additionalWaitMin,
    plannedEtaMin: state.plannedEtaMin,
  }));
}
