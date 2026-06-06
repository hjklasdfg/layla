import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { UserPreference } from "@/lib/agent/types";

export function rankRoutes(
  routes: EnrichedRoute[],
  preference: UserPreference
): string[] {
  const scored = routes.map((r) => {
    let score = r.signals.accessibility;
    if (preference.priority === "fastest") score = 100 - r.etaMin;
    else if (preference.priority === "least_stressful") score = 100 - r.signals.stress;
    else if (preference.priority === "most_reliable") score = r.signals.reliability;
    return { routeId: r.routeId, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.routeId);
}
