import type { CityEventType } from "./types";
import type { MobilityRecommendation } from "@/lib/agent/types";

export function getEventTimelineMessages(
  _eventType: CityEventType,
  scoreChanges: { routeId: string; label: string; delta: number }[],
  recChanged: boolean,
  newRecommendedRouteId?: string
): { event: string; followUps: string[] } {
  const followUps: string[] = [];

  for (const change of scoreChanges) {
    const direction = change.delta > 0 ? "improved" : "worsened";
    followUps.push(`Route ${change.routeId} ${change.label} ${direction} by ${Math.abs(change.delta)}`);
  }

  if (recChanged && newRecommendedRouteId) {
    followUps.push(`Recommendation changed to Route ${newRecommendedRouteId}`);
  }

  return {
    event: "Live conditions updated",
    followUps,
  };
}
