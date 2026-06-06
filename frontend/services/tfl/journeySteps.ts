import type { JourneyStep, TfLJourneyLeg } from "./types";

const MODE_LABELS: Record<string, string> = {
  walking: "Walk",
  tube: "Tube",
  bus: "Bus",
  overground: "Overground",
  "elizabeth-line": "Elizabeth line",
  dlr: "DLR",
  "national-rail": "National Rail",
  tram: "Tram",
  "river-bus": "River Bus",
  coach: "Coach",
  "replacement-bus": "Replacement Bus",
};

function modeLabel(modeId: string): string {
  return MODE_LABELS[modeId] ?? modeId.charAt(0).toUpperCase() + modeId.slice(1);
}

function extractLineName(leg: TfLJourneyLeg): string | undefined {
  const option = leg.routeOptions?.[0];
  if (option?.name) return option.name;
  if (option?.lineIdentifier?.name) return option.lineIdentifier.name;
  return undefined;
}

function cleanInstruction(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Convert TfL journey legs into ordered step-by-step directions. */
export function parseJourneySteps(legs: TfLJourneyLeg[]): JourneyStep[] {
  return legs.map((leg, index) => {
    const modeId = leg.mode?.id ?? "unknown";
    const from = leg.departurePoint?.commonName ?? "Start";
    const to = leg.arrivalPoint?.commonName ?? "End";
    const durationMin = Math.max(1, Math.round(leg.duration ?? 1));
    const line = modeId === "walking" ? undefined : extractLineName(leg);
    const instruction = cleanInstruction(
      leg.instruction?.summary ??
        leg.instruction?.detailed ??
        `${modeLabel(modeId)} from ${from} to ${to}`
    );

    return {
      order: index + 1,
      mode: modeId,
      modeLabel: modeLabel(modeId),
      durationMin,
      from,
      to,
      line,
      instruction,
    };
  });
}

/** One-line route summary from steps, e.g. "Walk → Northern line → Walk". */
export function summarizeJourneySteps(steps: JourneyStep[]): string {
  const parts: string[] = [];

  for (const step of steps) {
    if (step.mode === "walking") {
      if (parts.length === 0 || parts[parts.length - 1] !== "Walk") {
        parts.push("Walk");
      }
    } else if (step.line) {
      parts.push(step.line);
    } else {
      parts.push(step.modeLabel);
    }
  }

  return parts.join(" → ");
}
