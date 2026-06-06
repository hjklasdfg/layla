import type { CityEventType } from "./types";

const EVENT_MESSAGES: Record<CityEventType, string> = {
  lift_outage: "Simulated lift outage — step-free access may be reduced",
  line_delay: "Simulated line delay — reliability scores updating",
  signal_failure: "Simulated signal failure — expect longer waits",
  heavy_rain: "Simulated heavy rain — crossing complexity elevated",
  crowd_surge: "Simulated crowd surge — stress and crowding scores rising",
  road_closure: "Simulated road closure — walking segments rerouted",
};

export function getEventTimelineMessages(
  eventType: CityEventType,
  scoreChanges: { routeId: string; label: string; delta: number }[],
  recChanged: boolean,
  newRouteId?: string
): { event: string; followUps: string[] } {
  const followUps: string[] = [];

  if (scoreChanges.length > 0) {
    const summary = scoreChanges
      .slice(0, 4)
      .map(
        (c) =>
          `Route ${c.routeId} ${c.label} ${c.delta > 0 ? "+" : ""}${c.delta}`
      )
      .join("; ");
    followUps.push(`Score changes detected: ${summary}`);
  } else {
    followUps.push("Live TfL data refreshed — scores recalculated");
  }

  if (recChanged && newRouteId) {
    followUps.push(`Recommendation updated — Route ${newRouteId} is now preferred`);
  }

  return {
    event: EVENT_MESSAGES[eventType],
    followUps,
  };
}
