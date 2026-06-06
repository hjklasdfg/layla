"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { CameraPanel, type CameraPanelHandle } from "@/components/CameraPanel";
import { isCameraOffCommand, isCameraOnCommand } from "@/lib/camera/voice-commands";
import { MobilityAgentPanel } from "@/components/MobilityAgentPanel";
import { NavigationPanel } from "@/components/NavigationPanel";
import { VoicePanel, type VoicePanelHandle } from "@/components/VoicePanel";
import { RouteCard } from "@/components/RouteCard";
import type { MobilityRecommendation, UserPreference, UserProfile } from "@/lib/agent/types";
import {
  PRIORITY_LABELS,
  PROFILE_LABELS,
  SELECTABLE_PERSONAS,
} from "@/lib/agent/types";
import { computePersonaRoutePicks } from "@/lib/mobility/persona-routes";
import type {
  CrimeIncident,
  CrimeIncidentMeta,
  CrimeIncidentResponse,
} from "@/lib/crime/types";
import type { CameraDataItem } from "@/lib/mobility/sensors";
import type { RouteExplanation } from "@/lib/mobility/plan";
import {
  isLikelyJourneyRequest,
  parseVoiceIntent,
  shouldTriggerMobilityPlan,
} from "@/lib/mobility/voice-intent";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLiveRoutes } from "@/hooks/useLiveRoutes";
import { useNavigation } from "@/hooks/useNavigation";

const RouteMap = dynamic(
  () => import("@/components/RouteMap").then((m) => m.RouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/60">
        <p className="font-mono text-xs text-slate-500">Loading map…</p>
      </div>
    ),
  }
);

const PREFERENCES: { value: UserPreference["priority"]; label: string }[] = [
  { value: "fastest", label: PRIORITY_LABELS.fastest },
  { value: "least_stressful", label: PRIORITY_LABELS.least_stressful },
  { value: "most_accessible", label: PRIORITY_LABELS.most_accessible },
  { value: "most_reliable", label: PRIORITY_LABELS.most_reliable },
];

function TfLStatusBanner({
  meta,
}: {
  meta: ReturnType<typeof useLiveRoutes>["routesMeta"];
}) {
  if (!meta) return null;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 px-3 py-2 text-xs text-blue-200/90">
        <p className="font-medium">
          Live TfL + OSM · {meta.count} route{meta.count !== 1 ? "s" : ""} ranked
          by mobility score
        </p>
        <p className="mt-0.5 truncate text-[11px] opacity-80">
          {meta.from} → {meta.to}
        </p>
      </div>
      {meta.osmWarning && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
          {meta.osmWarning}
        </div>
      )}
    </div>
  );
}

function MapPlaceholder({ routeCount }: { routeCount: number }) {
  return (
    <div className="map-grid relative flex h-[360px] min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/60 sm:h-[420px]">
      <p className="font-mono text-xs text-slate-500">
        {routeCount > 0
          ? `${routeCount} route${routeCount !== 1 ? "s" : ""} loading on map…`
          : "Enter locations to search TfL + OSM"}
      </p>
    </div>
  );
}

export default function Home() {
  const {
    routes,
    mobilityRoutes,
    routesMeta,
    prevSignals,
    recommendationUpdated,
    isSearching,
    fetchError,
    canRetry,
    runMobilityPlan,
    clearRecommendationUpdated,
    clearError,
  } = useLiveRoutes();

  const [start, setStart] = useState("");
  const [destination, setDestination] = useState("");
  const [selectedProfiles, setSelectedProfiles] = useState<UserProfile[]>([
    "wheelchair",
  ]);
  const [useCustomPersona, setUseCustomPersona] = useState(false);
  const [priority, setPriority] =
    useState<UserPreference["priority"]>("most_accessible");
  const [customNotes, setCustomNotes] = useState("");
  const [compared, setCompared] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<MobilityRecommendation | null>(
    null
  );
  const [routeExplanation, setRouteExplanation] = useState<RouteExplanation | null>(
    null
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [highContrastMap, setHighContrastMap] = useState(false);
  const [crimeIncidents, setCrimeIncidents] = useState<CrimeIncident[]>([]);
  const [crimeMeta, setCrimeMeta] = useState<CrimeIncidentMeta | null>(null);
  const [crimeLayerVisible, setCrimeLayerVisible] = useState(false);
  const [crimeLoading, setCrimeLoading] = useState(false);
  const [crimeError, setCrimeError] = useState<string | null>(null);
  const [journeyMarkers, setJourneyMarkers] = useState<{
    start?: { lat: number; lng: number; name: string };
    end?: { lat: number; lng: number; name: string };
  }>({});
  const [mapRevision, setMapRevision] = useState("initial");
  const { location: gpsLocation } = useGeolocation(true);
  const nav = useNavigation();
  const voiceRef = useRef<VoicePanelHandle>(null);
  const cameraRef = useRef<CameraPanelHandle>(null);
  const planningInFlightRef = useRef(false);

  const activePersonas: UserProfile[] = useMemo(() => {
    if (useCustomPersona) return ["custom"];
    if (selectedProfiles.length) return selectedProfiles;
    return ["general"];
  }, [selectedProfiles, useCustomPersona]);

  const preference: UserPreference = {
    profile: activePersonas[0] ?? "general",
    profiles: activePersonas.length > 1 ? activePersonas : undefined,
    priority,
    ...(customNotes.trim() ? { customNotes: customNotes.trim() } : {}),
  };

  const personaRoutePicks = useMemo(() => {
    if (!routes.length) return [];
    if (activePersonas[0] === "custom" || activePersonas[0] === "general") return [];
    return computePersonaRoutePicks(routes, activePersonas, priority);
  }, [routes, activePersonas, priority]);

  function togglePersona(persona: UserProfile) {
    setUseCustomPersona(false);
    setSelectedProfiles((prev) => {
      if (prev.includes(persona)) {
        const next = prev.filter((p) => p !== persona);
        return next.length ? next : [persona];
      }
      return [...prev, persona];
    });
  }

  function enableCustomPersona() {
    setUseCustomPersona(true);
  }

  function enableSelectablePersonas() {
    setUseCustomPersona(false);
    if (!selectedProfiles.length) {
      setSelectedProfiles(["wheelchair"]);
    }
  }
  const journeyLabel =
    start && destination ? `${start} → ${destination}` : undefined;

  const cameraData: CameraDataItem[] = [];

  async function runPlan(options: {
    audioInput?: string;
    journey?: { start?: string; destination?: string };
    profileOverride?: UserPreference["profile"];
  }) {
    if (planningInFlightRef.current) return;
    planningInFlightRef.current = true;

    setCompared(true);
    setAgentLoading(true);
    setRecommendation(null);
    setRouteExplanation(null);
    setJourneyMarkers({});
    setMapRevision(`pending-${Date.now()}`);
    clearRecommendationUpdated();
    clearError();

    const planPreference: UserPreference = {
      profile: options.profileOverride ?? preference.profile,
      profiles: options.profileOverride
        ? [options.profileOverride]
        : preference.profiles,
      priority,
      ...(customNotes.trim() ? { customNotes: customNotes.trim() } : {}),
    };

    if (options.profileOverride) {
      setUseCustomPersona(false);
      setSelectedProfiles([options.profileOverride]);
    }

    if (options.audioInput) {
      voiceRef.current?.notifyPlanningStarted(
        options.journey?.start && options.journey?.destination
          ? {
              start: options.journey.start,
              destination: options.journey.destination,
            }
          : undefined
      );
    }

    try {
      const result = await runMobilityPlan({
        audioInput: options.audioInput,
        gps: gpsLocation,
        cameraData,
        preference: planPreference,
        journey: options.journey,
      });

      setStart(result.journey.start);
      setDestination(result.journey.destination);
      setJourneyMarkers({
        start: result.meta.startPoint,
        end: result.meta.endPoint,
      });
      setMapRevision(
        `${result.journey.start}-${result.journey.destination}-${result.recommendation.recommendedRouteId}-${Date.now()}`
      );
      setSelectedRouteId(result.recommendation.recommendedRouteId);
      setRecommendation(result.recommendation);
      setRouteExplanation(result.explanation);
      voiceRef.current?.announceRouteExplanation(
        result.explanation,
        result.recommendation,
        {
          journey: result.journey,
          preference: {
            profile: planPreference.profile,
            priority: planPreference.priority,
          },
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mobility plan failed";
      voiceRef.current?.notifyPlanningFailed(message);
    } finally {
      setAgentLoading(false);
      planningInFlightRef.current = false;
    }
  }

  async function handleCompare() {
    if (!start.trim() || !destination.trim()) return;
    await runPlan({
      journey: {
        start: start.trim(),
        destination: destination.trim(),
      },
    });
  }

  async function handleVoiceInput(text: string) {
    if (isCameraOnCommand(text)) {
      try {
        await cameraRef.current?.startRecording();
      } catch {
        // CameraPanel shows its own error
      }
      return;
    }

    if (isCameraOffCommand(text)) {
      cameraRef.current?.stopRecording();
      return;
    }

    const voiceIntent = parseVoiceIntent(text);
    if (voiceIntent.profile) {
      setUseCustomPersona(false);
      setSelectedProfiles([voiceIntent.profile]);
    }

    if (!shouldTriggerMobilityPlan(text)) {
      if (isLikelyJourneyRequest(text)) {
        voiceRef.current?.notifyHeardButNoJourney();
      }
      return;
    }

    if (planningInFlightRef.current) return;

    voiceRef.current?.notifySpeechReceived(text, voiceIntent.journey);

    void runPlan({
      audioInput: text,
      profileOverride: voiceIntent.profile,
      journey: {
        start: voiceIntent.journey.start,
        destination: voiceIntent.journey.destination,
      },
    });
  }

  async function handleRetry() {
    clearError();
    await handleCompare();
  }

  async function handleCrimeMapToggle() {
    if (crimeIncidents.length > 0) {
      setCrimeLayerVisible((visible) => !visible);
      return;
    }

    setCrimeLoading(true);
    setCrimeError(null);

    try {
      const response = await fetch("/api/crime-incidents");
      const payload = (await response.json()) as
        | CrimeIncidentResponse
        | { error?: string };

      if (!response.ok || !("incidents" in payload)) {
        const message =
          "error" in payload ? payload.error : "Failed to load crime incidents";

        throw new Error(message ?? "Failed to load crime incidents");
      }

      setCrimeIncidents(payload.incidents);
      setCrimeMeta(payload.meta);
      setCrimeLayerVisible(true);
    } catch (err) {
      setCrimeLayerVisible(false);
      setCrimeError(
        err instanceof Error ? err.message : "Failed to load crime incidents"
      );
    } finally {
      setCrimeLoading(false);
    }
  }

  const recommendedId = recommendation?.recommendedRouteId ?? null;
  const highlightedRouteId = selectedRouteId ?? recommendedId;
  const inputClass =
    "w-full rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30";

  const busy = agentLoading || isSearching;
  const showMap = mobilityRoutes.length > 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
              Layla
              <span className="ml-2 font-normal text-slate-400">—</span>
              <span className="ml-2 font-normal text-cyan-400">
                Accessibility Mobility Intelligence
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Live TfL · Mobility scoring · AI agent
            </p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-50" />
              <span className="relative h-2 w-2 rounded-full bg-blue-400" />
            </span>
            <span className="font-mono text-xs text-slate-500">TfL LIVE</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="space-y-4 lg:col-span-4">
            <VoicePanel ref={voiceRef} onUserSpeech={handleVoiceInput} />

            <CameraPanel
              ref={cameraRef}
              gps={gpsLocation}
              locationDescription={journeyLabel}
            />

            <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 backdrop-blur">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-cyan-400">
                Plan Your Journey
              </h2>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">From</span>
                  <input
                    type="text"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    placeholder="e.g. King's Cross Station"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">To</span>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="e.g. British Museum"
                    className={inputClass}
                  />
                </label>
                <fieldset className="block">
                  <legend className="mb-2 block text-xs text-slate-400">
                    Travellers (tick all that apply)
                  </legend>
                  <div className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-900/50 p-3">
                    {SELECTABLE_PERSONAS.map((persona) => {
                      const checked =
                        !useCustomPersona && selectedProfiles.includes(persona);
                      return (
                        <label
                          key={persona}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
                            checked
                              ? "bg-cyan-500/10 text-cyan-100"
                              : "text-slate-300 hover:bg-slate-800/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={useCustomPersona}
                            onChange={() => togglePersona(persona)}
                            className="h-4 w-4 accent-cyan-400"
                          />
                          {PROFILE_LABELS[persona]}
                        </label>
                      );
                    })}
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-md border-t border-slate-700/60 px-2 pt-2 text-sm ${
                        useCustomPersona
                          ? "bg-violet-500/10 text-violet-100"
                          : "text-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={useCustomPersona}
                        onChange={(e) =>
                          e.target.checked ? enableCustomPersona() : enableSelectablePersonas()
                        }
                        className="h-4 w-4 accent-violet-400"
                      />
                      {PROFILE_LABELS.custom}
                    </label>
                  </div>
                  {personaRoutePicks.length > 0 && (
                    <p className="mt-1.5 text-[11px] leading-snug text-cyan-400/90">
                      {personaRoutePicks.length > 1
                        ? "Map shows a recommended path per traveller (coloured lines)."
                        : "Map highlights the best route for your selected traveller."}
                    </p>
                  )}
                  {!useCustomPersona && selectedProfiles.length === 1 && (
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                      Tick more personas to compare routes for a group on the map.
                    </p>
                  )}
                </fieldset>
                {useCustomPersona && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-400">
                      Describe your needs
                    </span>
                    <textarea
                      value={customNotes}
                      onChange={(e) => setCustomNotes(e.target.value)}
                      placeholder="e.g. Avoid stairs, prefer step-free stations, sensitive to crowds…"
                      rows={3}
                      className={`${inputClass} resize-y`}
                    />
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Custom notes are sent to the mobility agent. Preference still
                      decides the main ranking.
                    </p>
                  </label>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">
                    Preference
                    {useCustomPersona ? (
                      <span className="ml-1 text-violet-500/80">· primary</span>
                    ) : null}
                  </span>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as UserPreference["priority"])
                    }
                    className={inputClass}
                  >
                    {PREFERENCES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleCompare}
                  disabled={!start.trim() || !destination.trim() || busy}
                  className="w-full rounded-lg bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSearching
                    ? "Fetching TfL routes…"
                    : agentLoading
                      ? "Analysing…"
                      : "Compare Routes"}
                </button>
              </div>
            </div>

            <NavigationPanel
              selectedRouteGeometry={
                mobilityRoutes.find(
                  (r) => r.id === (highlightedRouteId ?? recommendedId)
                )?.geometry.coordinates ?? null
              }
              journeyLabel={journeyLabel}
              routeName={
                mobilityRoutes.find(
                  (r) => r.id === (highlightedRouteId ?? recommendedId)
                )?.name
              }
              nav={nav}
            />

            {fetchError && (
              <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                <p>{fetchError}</p>
                {canRetry && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={busy}
                    className="mt-2 rounded-md border border-red-400/40 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-900/30 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {compared && routesMeta && !fetchError && (
              <TfLStatusBanner meta={routesMeta} />
            )}

            {(compared || agentLoading) && (
              <MobilityAgentPanel
                recommendation={recommendation}
                explanation={routeExplanation}
                loading={agentLoading}
                journeyLabel={journeyLabel}
                recommendationUpdated={recommendationUpdated}
                onReplayVoice={
                  routeExplanation && recommendation
                    ? () =>
                        voiceRef.current?.announceRouteExplanation(
                          routeExplanation,
                          recommendation,
                          {
                            journey: { start, destination },
                            preference: {
                              profile: preference.profile,
                              priority: preference.priority,
                            },
                          }
                        )
                    : undefined
                }
              />
            )}
          </section>

          <section className="space-y-4 lg:col-span-8">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Route Map
              </h2>
              {mobilityRoutes.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setHighContrastMap((v) => !v)}
                    className="rounded-md border border-slate-600/60 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-300 hover:border-cyan-500/40"
                    aria-pressed={highContrastMap}
                  >
                    {highContrastMap ? "Standard map" : "High contrast"}
                  </button>
                </div>
              )}
            </div>

            {showMap ? (
              <RouteMap
                routes={mobilityRoutes}
                selectedRouteId={highlightedRouteId}
                onRouteSelect={setSelectedRouteId}
                startLabel={start || journeyMarkers.start?.name || "Start"}
                endLabel={destination || journeyMarkers.end?.name || "Destination"}
                startPoint={journeyMarkers.start ?? null}
                endPoint={journeyMarkers.end ?? null}
                mapRevision={mapRevision}
                highContrast={highContrastMap}
                crimeIncidents={crimeLayerVisible ? crimeIncidents : []}
                crimeMeta={crimeLayerVisible ? crimeMeta : null}
                personaRoutes={personaRoutePicks}
              />
            ) : (
              <MapPlaceholder routeCount={routes.length} />
            )}

            {crimeError && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-950/20 px-3 py-2 text-xs text-orange-200">
                {crimeError}
              </div>
            )}

            {!compared ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center">
                <div>
                  <p className="text-sm text-slate-500">
                    Enter London locations and click{" "}
                    <span className="text-cyan-400">Compare Routes</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Live TfL journeys with OpenStreetMap accessibility enrichment
                  </p>
                </div>
              </div>
            ) : routes.length === 0 && !isSearching ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center">
                <p className="text-sm text-slate-500">
                  {fetchError
                    ? "Could not load routes."
                    : "Searching for routes…"}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {routes.map((route) => {
                  const personaLabels = personaRoutePicks
                    .filter((pick) => pick.routeId === route.routeId)
                    .map((pick) => pick.label);
                  return (
                  <RouteCard
                    key={route.routeId}
                    route={route}
                    isRecommended={route.routeId === recommendedId}
                    prevSignals={prevSignals[route.routeId]}
                    isSelected={route.routeId === highlightedRouteId}
                    onSelect={() => setSelectedRouteId(route.routeId)}
                    personaLabels={personaLabels}
                  />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
