import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { UserPreference } from "@/lib/agent/types";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function scoreForPriority(route: EnrichedRoute, priority: UserPreference["priority"]): number {
  const { signals } = route;

  switch (priority) {
    case "fastest":
      return 1000 - route.etaMin;
    case "least_stressful":
      return clamp(100 - signals.stress);
    case "most_reliable":
      return signals.reliability;
    case "most_accessible":
    default:
      return signals.accessibility;
  }
}

function profileBoost(route: EnrichedRoute, profile: UserPreference["profile"]): number {
  const { signals } = route;
  switch (profile) {
    case "wheelchair":
      return signals.accessibility * 0.15 - signals.crossingComplexity * 0.05;
    case "blind":
      return signals.predictability * 0.1 - signals.crossingComplexity * 0.08;
    case "elderly":
      return signals.accessibility * 0.08 - signals.stress * 0.06;
    case "custom":
    case "general":
    default:
      return 0;
  }
}

/** Rank route IDs best-first for the given preference. */
export function rankRoutes(
  routes: EnrichedRoute[],
  preference: Pick<UserPreference, "profile" | "priority"> & { customNotes?: string }
): string[] {
  return [...routes]
    .sort((a, b) => {
      const scoreA =
        scoreForPriority(a, preference.priority) + profileBoost(a, preference.profile);
      const scoreB =
        scoreForPriority(b, preference.priority) + profileBoost(b, preference.profile);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.etaMin - b.etaMin;
    })
    .map((route) => route.routeId);
}
