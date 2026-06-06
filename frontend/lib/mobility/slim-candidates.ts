import type { RouteCandidate } from "@/services/tfl/types";
import type { BackendMobilityPlanRequest } from "@/lib/mobility/backend-plan-types";

/** Strip heavy rawJourney geometry from TfL candidates — keeps Gemini prompts small and fast. */
export function slimCandidatesForGemini(candidates: RouteCandidate[]) {
  return candidates.map((c) => ({
    id: c.id,
    etaMin: c.etaMin,
    transferCount: c.transferCount,
    walkingMinutes: c.walkingMinutes,
    modes: c.modes,
    disruptions: c.disruptions.slice(0, 4),
    instructions: c.instructions.slice(0, 10),
    steps: c.steps,
    stopPointIds: c.stopPointIds,
    lineIds: c.lineIds,
  }));
}

export function slimMobilityPlanRequestForGemini(
  request: BackendMobilityPlanRequest
): BackendMobilityPlanRequest {
  return {
    ...request,
    tflJourney: {
      ...request.tflJourney,
      candidates: slimCandidatesForGemini(request.tflJourney.candidates) as RouteCandidate[],
    },
  };
}
