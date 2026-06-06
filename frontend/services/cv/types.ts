/** Computer vision observation layer — replace mock with inference pipeline output. */
export interface CVObservation {
  crowdDensity: number;
  obstacleDensity: number;
  crossingVisibility: number;
}

export interface CVNormalized {
  stressImpact: number;
  accessibilityImpact: number;
  predictabilityImpact: number;
  crowdDensity: number;
  obstacleDensity: number;
  evidence: string[];
}
