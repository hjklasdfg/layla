import type { LiftOutage } from "../types";

/** Mock lift outage adapter — replace with TfL Lift Disruptions API. */
export async function fetchLiftOutages(
  stationIds: string[]
): Promise<LiftOutage[]> {
  void stationIds;
  return [];
}

export function getMockLiftOutages(routeId: string): LiftOutage[] {
  if (routeId === "A") {
    return [
      { station: "Euston Square", line: "Circle", active: true },
      { station: "King's Cross St Pancras", line: "Victoria", active: false },
    ];
  }
  return [{ station: "Russell Square", line: "Piccadilly", active: false }];
}
