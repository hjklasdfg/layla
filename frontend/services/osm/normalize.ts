import type { LegacyOSMRouteContext, OSMNormalized } from "./types";

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** Transform legacy OSM infrastructure data into route intelligence signals. */
export function normalizeOSMData(ctx: LegacyOSMRouteContext): OSMNormalized {
  const evidence: string[] = [];
  let accessibilityImpact = 0;
  let stressImpact = 0;

  const crossingComplexity = clamp(ctx.crossings * 24 + (ctx.crossings > 2 ? 15 : 0));

  if (ctx.crossings >= 2) {
    evidence.push(`${ctx.crossings} major crossings`);
    stressImpact += ctx.crossings * 14;
  } else if (ctx.crossings === 1) {
    evidence.push("Single signalised crossing");
  }

  switch (ctx.tactilePaving) {
    case "continuous":
      evidence.push("Continuous tactile paving");
      accessibilityImpact -= 12;
      break;
    case "partial":
      evidence.push("Partial tactile paving");
      accessibilityImpact += 12;
      break;
    case "none":
      evidence.push("Missing tactile paving");
      accessibilityImpact += 35;
      break;
  }

  if (ctx.steps === 0 && ctx.wheelchairAccessible !== "none") {
    evidence.push("Step-free route available");
  }
  if (ctx.steps > 0) {
    evidence.push(`${ctx.steps} step segment${ctx.steps > 1 ? "s" : ""} detected`);
    accessibilityImpact += ctx.steps * 22;
    stressImpact += ctx.steps * 10;
  }

  if (ctx.wheelchairAccessible === "full") {
    accessibilityImpact -= 8;
  } else if (ctx.wheelchairAccessible === "none") {
    accessibilityImpact += 30;
    evidence.push("No wheelchair-accessible path");
  }

  if (ctx.footways >= 3) {
    evidence.push(`Wide footways (${ctx.footways} segments)`);
    accessibilityImpact -= 5;
  } else if (ctx.footways <= 1) {
    evidence.push("Narrow pavement segment detected");
    stressImpact += 15;
    accessibilityImpact += 10;
  }

  stressImpact += crossingComplexity * 0.25;

  return {
    accessibilityImpact: clamp(accessibilityImpact),
    stressImpact: clamp(stressImpact),
    crossingComplexity,
    evidence,
  };
}
