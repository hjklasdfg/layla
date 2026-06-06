"use client";

import type { UseNavigationResult } from "@/hooks/useNavigation";

interface NavigationPanelProps {
  /** Polyline of the currently-selected route from the main flow. */
  selectedRouteGeometry: [number, number][] | null;
  /** Display label like "Liverpool St → St Paul's" */
  journeyLabel?: string;
  /** Display name of the route being navigated. */
  routeName?: string;
  nav: UseNavigationResult;
}

export function NavigationPanel({
  selectedRouteGeometry,
  journeyLabel,
  routeName,
  nav,
}: NavigationPanelProps) {
  const canStart =
    Boolean(selectedRouteGeometry && selectedRouteGeometry.length >= 2) &&
    !nav.isNavigating &&
    !nav.loading;

  const currentManeuver = nav.route?.maneuvers[nav.currentManeuverIndex];
  const nextManeuver = nav.route?.maneuvers[nav.currentManeuverIndex + 1];

  async function handleStart() {
    if (!selectedRouteGeometry) return;
    await nav.startNavigation(selectedRouteGeometry);
  }

  async function handleStartDemo() {
    if (!selectedRouteGeometry) return;
    await nav.startNavigation(selectedRouteGeometry, { simulate: true });
  }

  function handleStop() {
    nav.stopNavigation();
  }

  const distColor =
    nav.distanceToNextM === null
      ? "text-slate-400"
      : nav.distanceToNextM < 30
        ? "text-red-400"
        : nav.distanceToNextM < 50
          ? "text-amber-400"
          : "text-slate-300";

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
          Voice Navigation
        </h2>
        {nav.isNavigating && (
          <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Navigating
          </span>
        )}
      </div>

      {/* ---- Idle ---- */}
      {!nav.isNavigating && !nav.arrived && (
        <>
          {!selectedRouteGeometry ? (
            <p className="mb-3 text-xs text-slate-400">
              Plan a journey above first. Then start navigation here.
            </p>
          ) : (
            <p className="mb-3 text-xs text-slate-400">
              Ready to navigate {routeName ?? "the selected route"}
              {journeyLabel ? ` (${journeyLabel})` : ""}.
            </p>
          )}
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="w-full rounded-lg bg-cyan-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {nav.loading ? "Getting turn-by-turn from Valhalla…" : "▶ Start Navigation"}
          </button>
          <button
            type="button"
            onClick={handleStartDemo}
            disabled={!canStart}
            className="mt-2 w-full rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ▶ Start demo (simulate GPS along route)
          </button>
          {nav.error && (
            <p className="mt-2 rounded bg-red-900/40 p-2 text-xs text-red-300">
              {nav.error}
            </p>
          )}
        </>
      )}

      {/* ---- Navigating ---- */}
      {nav.isNavigating && nav.route && (
        <div className="space-y-3">
          <div className="rounded-lg border border-cyan-500/20 bg-slate-900/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Current step — {nav.currentManeuverIndex + 1}/
              {nav.route.maneuvers.length}
            </div>
            <div className="mt-1 text-sm text-cyan-200">
              {currentManeuver?.instruction || "—"}
            </div>
            {currentManeuver?.streetNames.length ? (
              <div className="mt-1 text-[11px] text-slate-500">
                on {currentManeuver.streetNames.join(", ")}
              </div>
            ) : null}
          </div>

          {nextManeuver && nav.distanceToNextM !== null && (
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Next maneuver
              </div>
              <div className={`mt-0.5 text-lg font-semibold ${distColor}`}>
                in {nav.distanceToNextM.toFixed(0)} m
              </div>
              <div className="text-xs text-slate-400">
                {nextManeuver.voice.alert || nextManeuver.instruction}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              GPS
            </div>
            <div className="text-xs text-cyan-200">
              {nav.gpsTicks > 0
                ? `${nav.gpsTicks} updates received`
                : "Waiting for first GPS fix…"}
            </div>
            {nav.gpsError && (
              <div className="mt-0.5 rounded bg-red-900/40 p-1.5 text-[10px] text-red-300">
                {nav.gpsError}
              </div>
            )}
            {nav.lastGps && (
              <div className="mt-1 font-mono text-[10px] text-slate-500">
                {nav.lastGps.lat.toFixed(5)}, {nav.lastGps.lng.toFixed(5)}
                {nav.lastGps.accuracy && ` ±${nav.lastGps.accuracy.toFixed(0)}m`}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleStop}
            className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
          >
            ⏹ Stop Navigation
          </button>
        </div>
      )}

      {/* ---- Arrived ---- */}
      {nav.arrived && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-900/20 p-3">
          <div className="text-sm font-semibold text-emerald-300">
            🏁 You have arrived
          </div>
          <button
            type="button"
            onClick={handleStop}
            className="mt-2 rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
