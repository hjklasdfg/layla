import "server-only";

import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import { mobilityStatesToEnriched } from "@/lib/mobilityAdapter";
import type {
  BackendMobilityPlanRequest,
  BackendMobilityPlanResponse,
  RouteExplanation,
} from "@/lib/mobility/backend-plan-types";
import {
  buildMobilityRoutesFromCandidates,
  type MobilityRouteState,
} from "@/lib/mobilityEngine";
import { rankRoutes } from "@/lib/recommendation";
import { generateMobilityRecommendationServer } from "@/lib/agent/server-recommend";
import { requestGeminiMobilityPlan } from "@/lib/mobility/gemini-plan";
import { requestNemotronMobilityPlan } from "@/lib/mobility/nemotron-plan";
import { serverEnv } from "@/lib/config/env";
import {
  PRIORITY_LABELS,
  PROFILE_LABELS,
} from "@/lib/agent/types";

function buildLocalExplanation(
  recommendation: MobilityRecommendation,
  preference: UserPreference,
  journey: { start: string; destination: string }
): RouteExplanation {
  const uiText = [
    `**Why Route ${recommendation.recommendedRouteId}?**`,
    recommendation.tradeoffExplanation,
    "",
    recommendation.finalRecommendation,
    "",
    `_Based on your **${PROFILE_LABELS[preference.profile]}** profile and **${PRIORITY_LABELS[preference.priority]}** priority for ${journey.start} → ${journey.destination}._`,
  ].join("\n");

  const voiceText = recommendation.finalRecommendation
    .replace(/\*\*/g, "")
    .slice(0, 280);

  return { uiText, voiceText };
}

async function buildLocalPlanFallback(
  request: BackendMobilityPlanRequest
): Promise<BackendMobilityPlanResponse> {
  const { journey, preference, tflJourney, journeyAnchors } = request;
  const { routes: mobilityRoutes, osmWarning } = await buildMobilityRoutesFromCandidates(
    tflJourney.candidates,
    preference.profile,
    journeyAnchors
  );

  if (!mobilityRoutes.length) {
    throw new Error("No routes with map geometry found for these locations.");
  }

  const enriched = mobilityStatesToEnriched(mobilityRoutes);
  const rankedIds = rankRoutes(enriched, preference);
  const sorted = rankedIds
    .map((id) => enriched.find((route) => route.routeId === id))
    .filter((route): route is EnrichedRoute => route !== undefined);
  const mobilitySorted = rankedIds
    .map((id) => mobilityRoutes.find((route) => route.id === id))
    .filter((route): route is MobilityRouteState => route !== undefined);

  const routes = sorted.length ? sorted : enriched;
  const mobility = mobilitySorted.length ? mobilitySorted : mobilityRoutes;

  const recommendation = await generateMobilityRecommendationServer({
    routes,
    preference,
    journey,
    sensors: {
      audioInput: request.audioInput,
      gps: request.gps ?? null,
      cameraData: request.cameraData ?? [],
    },
  });

  return {
    journey,
    routes: mobility,
    enrichedRoutes: routes,
    recommendation,
    explanation: buildLocalExplanation(recommendation, preference, journey),
    meta: {
      source: "local",
      from: journey.start,
      to: journey.destination,
      count: routes.length,
      profile: preference.profile,
      osmWarning,
    },
  };
}

export async function requestBackendMobilityPlan(
  request: BackendMobilityPlanRequest
): Promise<BackendMobilityPlanResponse> {
  if (!serverEnv.backend.enabled) {
    const provider = serverEnv.llmProvider;

    if (provider === "gemini" && serverEnv.gemini.enabled) {
      return requestGeminiMobilityPlan(request);
    }

    if (serverEnv.nemotron.enabled) {
      return requestNemotronMobilityPlan(request);
    }

    if (serverEnv.gemini.enabled) {
      return requestGeminiMobilityPlan(request);
    }

    return buildLocalPlanFallback(request);
  }

  const url = `${serverEnv.backend.apiUrl.replace(/\/$/, "")}/mobility/plan`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(serverEnv.backend.apiKey
        ? { Authorization: `Bearer ${serverEnv.backend.apiKey}` }
        : {}),
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Backend plan error ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as BackendMobilityPlanResponse;

  if (!data.explanation?.voiceText) {
    data.explanation = buildLocalExplanation(
      data.recommendation,
      request.preference,
      request.journey
    );
  }

  return data;
}
