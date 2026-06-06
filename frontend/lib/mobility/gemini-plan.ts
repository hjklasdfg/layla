import type {
  BackendMobilityPlanRequest,
  BackendMobilityPlanResponse,
  RouteExplanation,
} from "@/lib/mobility/backend-plan-types";
import { mobilityStatesToEnriched } from "@/lib/mobilityAdapter";
import { buildMobilityRoutesFromCandidates } from "@/lib/mobilityEngine";
import { serverEnv } from "@/lib/config/env";
import { buildLlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import { parseLlmJsonResponse } from "@/lib/mobility/llm-json";
import { slimMobilityPlanRequestForGemini } from "@/lib/mobility/slim-candidates";

interface GeminiPlanPayload {
  recommendation: {
    recommendedRouteId: string;
    routeComparison: string;
    tradeoffExplanation: string;
    finalRecommendation: string;
  };
  explanation: RouteExplanation;
}

async function callGeminiPlan(llmInput: LlmPlanInput): Promise<GeminiPlanPayload> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${serverEnv.gemini.model}:generateContent?key=${serverEnv.gemini.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: llmInput.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: llmInput.userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini plan error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty plan response");

  const parsed = parseLlmJsonResponse<GeminiPlanPayload>(text);

  if (!parsed.recommendation?.recommendedRouteId || !parsed.explanation?.voiceText) {
    throw new Error("Gemini plan response missing recommendation or explanation");
  }

  return parsed;
}

export async function requestGeminiMobilityPlan(
  request: BackendMobilityPlanRequest
): Promise<BackendMobilityPlanResponse> {
  if (!serverEnv.gemini.enabled) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const { journey, preference, tflJourney } = request;
  const slimRequest = slimMobilityPlanRequestForGemini(request);
  const llmInput = buildLlmPlanInput(slimRequest, serverEnv.gemini.model);

  // LLM (slim payload) and OSM enrichment run in parallel — no 30s serial wait.
  const [parsed, enrichment] = await Promise.all([
    callGeminiPlan(llmInput),
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
      provider: "gemini",
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
      /** @deprecated use llmInput */
      geminiInput: llmInput,
    },
  };
}
