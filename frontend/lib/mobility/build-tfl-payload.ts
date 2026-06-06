import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { TflDataPayload } from "./sensors";

export function buildTflDataPayload(
  from: string,
  to: string,
  profile: string,
  routes: EnrichedRoute[],
  osmWarning?: string
): TflDataPayload {
  return {
    from,
    to,
    profile,
    ...(osmWarning ? { osmWarning } : {}),
    routes: routes.map((route) => ({
      routeId: route.routeId,
      name: route.name,
      etaMin: route.etaMin,
      signals: route.signals,
      evidence: route.evidence,
      risks: route.risks,
      strengths: route.strengths,
    })),
  };
}
