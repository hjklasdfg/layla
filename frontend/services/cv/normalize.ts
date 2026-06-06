import type { CVNormalized, CVObservation } from "./types";

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** Convert CV observations into mobility impact signals. */
export function normalizeCVData(obs: CVObservation): CVNormalized {
  const evidence: string[] = [];

  const stressImpact = clamp(obs.crowdDensity * 0.85);
  const accessibilityImpact = clamp((100 - obs.crossingVisibility) * 0.65);
  const predictabilityImpact = clamp(obs.obstacleDensity * 0.75);

  if (obs.crowdDensity >= 65) {
    evidence.push("High pedestrian density detected");
  } else if (obs.crowdDensity >= 35) {
    evidence.push("Moderate foot traffic observed");
  } else {
    evidence.push("Low crowd density — clear path");
  }

  if (obs.obstacleDensity >= 40) {
    evidence.push("Temporary obstruction observed");
  }

  if (obs.crossingVisibility < 55) {
    evidence.push("Crossing visibility reduced");
  } else {
    evidence.push("Clear sightlines at crossings");
  }

  return {
    stressImpact,
    accessibilityImpact,
    predictabilityImpact,
    crowdDensity: clamp(obs.crowdDensity),
    obstacleDensity: clamp(obs.obstacleDensity),
    evidence,
  };
}
