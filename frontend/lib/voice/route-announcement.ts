import type { MobilityRecommendation } from "@/lib/agent/types";
import type { RouteExplanation } from "@/lib/mobility/plan";

/** Context stored in memory — not sent to ElevenLabs agent (listen-only mode). */
export function buildRouteContextUpdate(
  explanation: RouteExplanation,
  recommendation: MobilityRecommendation
): string {
  return [
    "[Layla mobility plan result]",
    `Recommended route ID: ${recommendation.recommendedRouteId}`,
    `Path pick explanation (UI): ${explanation.uiText.replace(/\*\*/g, "")}`,
    `Voice explanation: ${explanation.voiceText}`,
    `Comparison: ${recommendation.routeComparison}`,
    `Trade-offs: ${recommendation.tradeoffExplanation}`,
    `Final recommendation: ${recommendation.finalRecommendation.replace(/\*\*/g, "")}`,
  ].join("\n");
}
