"use client";

import type { AccessibilitySignals, EnrichedRoute } from "@/lib/accessibility/types";
import { AnimatedScoreMetric } from "./AnimatedScoreMetric";
import { JourneySteps } from "./JourneySteps";

function OSMEvidencePanel({ route }: { route: EnrichedRoute }) {
  if (route.evidence.osm.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-orange-500/20 bg-orange-950/10 px-3 py-2.5">
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-orange-400">
        OSM Evidence
      </h4>
      <ul className="space-y-1">
        {route.evidence.osm.map((item) => (
          <li key={item} className="text-xs leading-snug text-slate-400">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidencePanel({ route }: { route: EnrichedRoute }) {
  const sources = [
    { key: "tfl" as const, label: "TfL", color: "text-blue-400", dot: "bg-blue-400" },
    { key: "osm" as const, label: "OSM", color: "text-orange-400", dot: "bg-orange-400" },
    { key: "cv" as const, label: "CV", color: "text-pink-400", dot: "bg-pink-400" },
  ].filter(({ key }) => route.evidence[key].length > 0);

  if (sources.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-700/50 pt-4">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Multi-Source Evidence
      </h4>
      <div className="space-y-2.5">
        {sources.map(({ key, label, color, dot }) => (
          <div key={key}>
            <span className={`flex items-center gap-1.5 text-[10px] font-mono font-semibold ${color}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {label}
            </span>
            <ul className="mt-1 space-y-1">
              {route.evidence[key].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-1.5 text-xs leading-snug text-slate-400"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RouteCardProps {
  route: EnrichedRoute;
  isRecommended: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  prevSignals?: AccessibilitySignals;
}

export function RouteCard({
  route,
  isRecommended,
  isSelected,
  onSelect,
  prevSignals,
}: RouteCardProps) {
  const { signals } = route;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`relative flex cursor-pointer flex-col rounded-xl border p-5 transition-all duration-500 ${
        isRecommended
          ? "border-cyan-500/60 bg-cyan-950/20 shadow-[0_0_30px_rgba(34,211,238,0.12)]"
          : isSelected
            ? "border-violet-500/50 bg-violet-950/15 ring-1 ring-violet-500/30"
            : "border-slate-700/60 bg-slate-900/40 hover:border-slate-600"
      }`}
    >
      {isRecommended && (
        <span className="absolute -top-3 left-4 rounded-full bg-cyan-500 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-950">
          Recommended
        </span>
      )}

      <header className="mb-4 flex items-start justify-between gap-3 pt-1">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Route {route.routeId}
          </p>
          <h3 className="text-lg font-semibold text-white">{(route as {name?: string}).name ?? `Route ${route.routeId}`}</h3>
          {(route.steps?.length ?? 0) > 0 ? (
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">
              {route.steps!.map((s) =>
                s.mode === "walking"
                  ? `Walk ${s.durationMin}m`
                  : s.line
                    ? `${s.line} ${s.durationMin}m`
                    : `${s.modeLabel} ${s.durationMin}m`
              ).join(" → ")}
            </p>
          ) : (
            ((route as {transferCount?: number}).transferCount !== undefined ||
              (route as {walkingMinutes?: number}).walkingMinutes !== undefined) && (
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {(route as {transferCount?: number}).transferCount ?? 0} transfers ·{" "}
                {(route as {walkingMinutes?: number}).walkingMinutes ?? 0} min walk
              </p>
            )
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">ETA</p>
          <p className="font-mono text-2xl font-bold text-cyan-400">
            {route.etaMin}
            <span className="text-sm text-slate-400"> min</span>
          </p>
          {((route as {additionalWaitMin?: number}).additionalWaitMin ?? 0) > 0 && (
            <p className="mt-0.5 font-mono text-[10px] text-red-300">
              incl. +{(route as {additionalWaitMin?: number}).additionalWaitMin} min wait
            </p>
          )}
          {(route as {plannedEtaMin?: number}).plannedEtaMin !== undefined &&
            (route as {plannedEtaMin?: number}).plannedEtaMin !== route.etaMin && (
              <p className="font-mono text-[10px] text-slate-600 line-through">
                {(route as {plannedEtaMin?: number}).plannedEtaMin} min planned
              </p>
            )}
        </div>
      </header>

      {route.steps && route.steps.length > 0 && (
        <JourneySteps steps={route.steps} />
      )}

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cyan-500/80">
          Accessibility State Engine
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <AnimatedScoreMetric
            label="Accessibility"
            value={signals.accessibility}
            previousValue={prevSignals?.accessibility}
          />
          <AnimatedScoreMetric
            label="Stress"
            value={signals.stress}
            previousValue={prevSignals?.stress}
            invert
          />
          <AnimatedScoreMetric
            label="Reliability"
            value={signals.reliability}
            previousValue={prevSignals?.reliability}
          />
          <AnimatedScoreMetric
            label="Predictability"
            value={signals.predictability}
            previousValue={prevSignals?.predictability}
          />
          <AnimatedScoreMetric
            label="Crowding"
            value={(signals as {crowding?: number}).crowding ?? 0}
            previousValue={(prevSignals as ({crowding?: number} | undefined))?.crowding}
            invert
          />
          <AnimatedScoreMetric
            label="Crossing Complexity"
            value={(signals as {crossingComplexity?: number}).crossingComplexity ?? 0}
            previousValue={(prevSignals as ({crossingComplexity?: number} | undefined))?.crossingComplexity}
            invert
          />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
            Key Risks
          </h4>
          <ul className="space-y-1.5">
            {((route as {risks?: string[]}).risks ?? []).map((risk) => (
              <li key={risk} className="text-sm leading-snug text-slate-400">
                {risk}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Key Strengths
          </h4>
          <ul className="space-y-1.5">
            {((route as {strengths?: string[]}).strengths ?? []).map((strength) => (
              <li key={strength} className="text-sm leading-snug text-slate-400">
                {strength}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <OSMEvidencePanel route={route} />
      <EvidencePanel route={route} />
    </article>
  );
}
