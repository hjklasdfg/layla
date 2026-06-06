import type { CVObservation } from "./types";

const MOCK_CV: Record<string, CVObservation> = {
  A: { crowdDensity: 78, obstacleDensity: 45, crossingVisibility: 38 },
  B: { crowdDensity: 28, obstacleDensity: 12, crossingVisibility: 88 },
};

export function getMockCVObservation(routeId: string): CVObservation {
  return MOCK_CV[routeId] ?? MOCK_CV.B;
}
