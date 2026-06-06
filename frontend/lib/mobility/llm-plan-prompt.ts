import type { BackendMobilityPlanRequest } from "@/lib/mobility/backend-plan-types";

export const LLM_PLAN_SYSTEM_PROMPT = `You are the Layla mobility backend. You receive a POST /mobility/plan payload from the Layla frontend.

Your job:
1. Enrich each TfL candidate with simulated OSM accessibility data (steps, lifts, tactile paving, kerbs).
2. Score routes for the user's profile and priority.
3. Pick the best route and explain why.

Return JSON only (no markdown fences) with:
{
  "recommendation": {
    "recommendedRouteId": string,
    "routeComparison": string,
    "tradeoffExplanation": string,
    "finalRecommendation": string
  },
  "explanation": {
    "uiText": string,
    "voiceText": string
  }
}

Use route IDs exactly as provided in tflJourney.candidates (e.g. "A", "B", "C").
voiceText must be 1-2 plain sentences with no markdown — ElevenLabs reads it verbatim.`;

export interface LlmPlanInput {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  request: BackendMobilityPlanRequest;
}

export function buildLlmPlanInput(
  request: BackendMobilityPlanRequest,
  model: string
): LlmPlanInput {
  const userPrompt = [
    "Process this Layla mobility plan request and return the backend JSON response.",
    "",
    JSON.stringify(request, null, 2),
  ].join("\n");

  return {
    model,
    systemPrompt: LLM_PLAN_SYSTEM_PROMPT,
    userPrompt,
    request,
  };
}
