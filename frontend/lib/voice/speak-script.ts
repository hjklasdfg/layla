import type { MobilityRecommendation } from "@/lib/agent/types";
import type { RouteExplanation } from "@/lib/mobility/plan";

function plainText(value: string): string {
  return value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/** Ordered lines to speak when a mobility plan JSON response arrives. */
export function buildSpeakLinesFromPlan(
  explanation: RouteExplanation,
  recommendation: MobilityRecommendation
): string[] {
  const lines: string[] = [];

  const voice = explanation.voiceText?.trim();
  if (voice) lines.push(voice);

  const final = plainText(recommendation.finalRecommendation ?? "");
  if (final && final !== voice && !voice?.includes(final.slice(0, 48))) {
    lines.push(final);
  }

  if (lines.length === 0) {
    lines.push(
      `I recommend route ${recommendation.recommendedRouteId} for your journey.`
    );
  }

  return lines;
}
