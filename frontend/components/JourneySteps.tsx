"use client";

import type { JourneyStep } from "@/services/tfl/types";

const MODE_BADGES: Record<string, string> = {
  walking: "W",
  tube: "T",
  bus: "B",
  overground: "OG",
  "elizabeth-line": "EL",
  dlr: "D",
  "national-rail": "NR",
  tram: "Tr",
};

function stepBadge(mode: string): string {
  return MODE_BADGES[mode] ?? mode.slice(0, 2).toUpperCase();
}

const RISK_STYLES: Record<
  NonNullable<JourneyStep["connectionRisk"]>,
  { badge: string; text: string }
> = {
  immediate: { badge: "bg-emerald-500/20 text-emerald-300", text: "Departing now" },
  tight: { badge: "bg-amber-500/20 text-amber-300", text: "Tight connection" },
  comfortable: { badge: "bg-slate-600/30 text-slate-300", text: "Wait" },
  long: { badge: "bg-red-500/20 text-red-300", text: "Long wait" },
};

function ConnectionBadge({ step }: { step: JourneyStep }) {
  if (step.connectionRisk === undefined || step.nextServiceInMin === undefined) {
    return null;
  }

  const style = RISK_STYLES[step.connectionRisk];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
      >
        {style.text}
      </span>
      <span className="text-xs text-slate-300">
        Next service in{" "}
        <span className="font-mono font-semibold text-white">
          {step.nextServiceInMin} min
        </span>
        {step.extraWaitMin && step.extraWaitMin > 0 ? (
          <span className="text-red-300"> (+{step.extraWaitMin} min to ETA)</span>
        ) : null}
      </span>
      {step.connectionNote && (
        <p className="w-full text-xs leading-snug text-slate-500">
          {step.connectionNote}
        </p>
      )}
    </div>
  );
}

function stepAccent(mode: string): string {
  if (mode === "walking") return "border-slate-500/50 bg-slate-800/40";
  if (mode === "tube" || mode === "elizabeth-line") return "border-blue-500/40 bg-blue-950/30";
  if (mode === "bus") return "border-red-500/40 bg-red-950/20";
  return "border-violet-500/40 bg-violet-950/20";
}

interface JourneyStepsProps {
  steps: JourneyStep[];
  compact?: boolean;
}

export function JourneySteps({ steps, compact = false }: JourneyStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-700/50 pt-4">
      <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Step-by-step directions
      </h4>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={`${step.order}-${step.mode}-${step.from}`}
            className={`rounded-lg border px-3 py-2.5 ${stepAccent(step.mode)}`}
          >
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950/60 font-mono text-[10px] font-bold text-cyan-300"
                aria-hidden
              >
                {stepBadge(step.mode)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-white">
                    {step.mode === "walking"
                      ? `Walk ${step.durationMin} min`
                      : step.line
                        ? `${step.modeLabel} · ${step.line} · ${step.durationMin} min`
                        : `${step.modeLabel} · ${step.durationMin} min`}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    Step {step.order}
                  </span>
                </div>
                {!compact && (
                  <>
                    <p className="mt-1 text-xs leading-snug text-slate-300">
                      {step.from} → {step.to}
                    </p>
                    <p className="mt-1 text-xs leading-snug text-slate-500">
                      {step.instruction}
                    </p>
                  </>
                )}
                {compact && (
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {step.from} → {step.to}
                  </p>
                )}
                {step.mode !== "walking" && <ConnectionBadge step={step} />}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
