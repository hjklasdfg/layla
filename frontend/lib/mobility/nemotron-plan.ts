import type {
  BackendMobilityPlanRequest,
  BackendMobilityPlanResponse,
  RouteExplanation,
} from "@/lib/mobility/backend-plan-types";
import { mobilityStatesToEnriched } from "@/lib/mobilityAdapter";
import { buildMobilityRoutesFromCandidates } from "@/lib/mobilityEngine";
import { serverEnv } from "@/lib/config/env";
import { parseLlmJsonResponse } from "@/lib/mobility/llm-json";
import { buildLlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import { slimMobilityPlanRequestForGemini } from "@/lib/mobility/slim-candidates";

interface LlmPlanPayload {
  recommendation: {
    recommendedRouteId: string;
    routeComparison: string;
    tradeoffExplanation: string;
    finalRecommendation: string;
  };
  explanation: RouteExplanation;
}

async function callNemotronPlan(
  systemPrompt: string,
  userPrompt: string
): Promise<LlmPlanPayload> {
  const baseUrl = serverEnv.nemotron.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (serverEnv.nemotron.apiKey) {
    headers.Authorization = `Bearer ${serverEnv.nemotron.apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: serverEnv.nemotron.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Nemotron plan error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Nemotron returned empty plan response");

  const parsed = parseLlmJsonResponse<LlmPlanPayload>(text);

  if (!parsed.recommendation?.recommendedRouteId || !parsed.explanation?.voiceText) {
    throw new Error("Nemotron plan response missing recommendation or explanation");
  }

  return parsed;
}

export async function requestNemotronMobilityPlan(
  request: BackendMobilityPlanRequest
): Promise<BackendMobilityPlanResponse> {
  if (!serverEnv.nemotron.enabled) {
    throw new Error("NEMOTRON_BASE_URL not configured");
  }

  const { journey, preference, tflJourney } = request;
  const slimRequest = slimMobilityPlanRequestForGemini(request);
  const llmInput = buildLlmPlanInput(slimRequest, serverEnv.nemotron.model);

  const [parsed, enrichment] = await Promise.all([
    callNemotronPlan(llmInput.systemPrompt, llmInput.userPrompt),
    buildMobilityRoutesFromCandidates(tflJourney.candidates, preference.profile),
  ]);

  const { routes: mobilityRoutes, osmWarning } = enrichment;

  if (!mobilityRoutes.length) {
    throw new Error("No routes with map geometry found for these locations.");
  }

  const enrichedRoutes = mobilityStatesToEnriched(mobilityRoutes);

  return {
    journey,
    routes: mobilityRoutes,
    enrichedRoutes,
    recommendation: {
      provider: "nemotron",
      recommendedRouteId: parsed.recommendation.recommendedRouteId,
      routeComparison: parsed.recommendation.routeComparison,
      tradeoffExplanation: parsed.recommendation.tradeoffExplanation,
      finalRecommendation: parsed.recommendation.finalRecommendation,
    },
    explanation: parsed.explanation,
    meta: {
      source: "backend",
      from: journey.start,
      to: journey.destination,
      count: mobilityRoutes.length,
      profile: preference.profile,
      osmWarning,
      llmInput,
    },
  };
}
