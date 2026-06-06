import { getMockBusArrivals } from "./adapters/bus-arrivals";
import { getMockLiftOutages } from "./adapters/lift-outages";
import { getMockLineStatus } from "./adapters/line-status";
import type { TfLRouteSnapshot } from "./types";

export function getMockTfLSnapshot(routeId: string): TfLRouteSnapshot {
  return {
    liftOutages: getMockLiftOutages(routeId),
    lineStatuses: getMockLineStatus(routeId),
    busArrivals: getMockBusArrivals(routeId),
  };
}
