import type { TfLNormalized, TfLRouteSnapshot } from "./types";

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** Convert raw TfL feed into mobility impact signals and evidence strings. */
export function normalizeTfLData(data: TfLRouteSnapshot): TfLNormalized {
  const evidence: string[] = [];
  let reliabilityImpact = 0;
  let accessibilityImpact = 0;
  let predictabilityImpact = 0;
  let transportDelayRisk = 0;
  let liftOutageRisk = 0;

  for (const outage of data.liftOutages) {
    if (outage.active) {
      liftOutageRisk += 45;
      accessibilityImpact += 40;
      reliabilityImpact += 25;
      evidence.push(`Lift outage detected — ${outage.station}`);
    }
  }

  for (const line of data.lineStatuses) {
    if (line.severity === "good") continue;
    const delay = line.delayMinutes ?? (line.severity === "severe" ? 12 : 5);
    transportDelayRisk += Math.min(85, delay * 7);
    reliabilityImpact += Math.min(55, delay * 5);
    predictabilityImpact += Math.min(45, delay * 4);
    evidence.push(`${line.name} delayed`);
  }

  for (const bus of data.busArrivals) {
    evidence.push(`Next bus in ${bus.minutesAway} minutes`);
    if (bus.minutesAway > 6) {
      const waitPenalty = (bus.minutesAway - 6) * 6;
      predictabilityImpact += waitPenalty;
      transportDelayRisk += waitPenalty * 0.7;
    }
  }

  if (evidence.length === 0) {
    evidence.push("All lines reporting good service");
  }

  return {
    reliabilityImpact: clamp(reliabilityImpact),
    accessibilityImpact: clamp(accessibilityImpact),
    predictabilityImpact: clamp(predictabilityImpact),
    transportDelayRisk: clamp(transportDelayRisk),
    liftOutageRisk: clamp(liftOutageRisk),
    evidence,
  };
}
