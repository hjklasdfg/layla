import type { BusArrival } from "../types";

/** Mock bus arrivals adapter — replace with TfL Bus Arrivals API. */
export async function fetchBusArrivals(stopId: string): Promise<BusArrival[]> {
  void stopId;
  return [];
}

export function getMockBusArrivals(routeId: string): BusArrival[] {
  if (routeId === "A") {
    return [{ routeId: "73", stopName: "Euston Station", minutesAway: 8 }];
  }
  return [{ routeId: "59", stopName: "Russell Square", minutesAway: 3 }];
}
