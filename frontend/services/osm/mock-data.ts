import type { LegacyOSMRouteContext } from "./types";

const MOCK_OSM: Record<string, LegacyOSMRouteContext> = {
  A: {
    crossings: 2,
    footways: 1,
    steps: 1,
    tactilePaving: "none",
    wheelchairAccessible: "partial",
  },
  B: {
    crossings: 1,
    footways: 4,
    steps: 0,
    tactilePaving: "continuous",
    wheelchairAccessible: "full",
  },
};

export function getMockOSMContext(routeId: string): LegacyOSMRouteContext {
  return MOCK_OSM[routeId] ?? MOCK_OSM.B;
}
