"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { CameraPanel, type CameraPanelHandle } from "@/components/CameraPanel";
import { isCameraOffCommand, isCameraOnCommand } from "@/lib/camera/voice-commands";
import { ChangeTimeline } from "@/components/ChangeTimeline";
import { GeminiInputPanel, type ClientPlanPreview } from "@/components/GeminiInputPanel";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import { EventSimulator } from "@/components/EventSimulator";
import { MobilityAgentPanel } from "@/components/MobilityAgentPanel";
import { VoicePanel, type VoicePanelHandle } from "@/components/VoicePanel";
import { RouteCard } from "@/components/RouteCard";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import { PRIORITY_LABELS, PROFILE_LABELS } from "@/lib/agent/types";
import type {
  CrimeIncident,
  CrimeIncidentMeta,
  CrimeIncidentResponse,
} from "@/lib/crime/types";
import type { CityEventType } from "@/lib/events/types";
import type { CameraDataItem } from "@/lib/mobility/sensors";
import type { RouteExplanation } from "@/lib/mobility/plan";
import {
  isLikelyJourneyRequest,
  parseVoiceIntent,
  shouldTriggerMobilityPlan,
} from "@/lib/mobility/voice-intent";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLiveRoutes } from "@/hooks/useLiveRoutes";

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

const USER_PROFILES: { value: UserPreference["profile"]; label: string }[] = [
  { value: "general", label: PROFILE_LABELS.general },
  { value: "blind", label: PROFILE_LABELS.blind },
  { value: "wheelchair", label: PROFILE_LABELS.wheelchair },
  { value: "elderly", label: PROFILE_LABELS.elderly },
  { value: "custom", label: PROFILE_LABELS.custom },
];

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
    timeline,
    recommendationUpdated,
    isSimulating,
    isSearching,
    fetchError,
    canRetry,
    runMobilityPlan,
    simulateEvent,
    clearRecommendationUpdated,
    clearError,
  } = useLiveRoutes();

  const [start, setStart] = useState("");
  const [destination, setDestination] = useState("");
  const [profile, setProfile] = useState<UserPreference["profile"]>("general");
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
  const [planClientPreview, setPlanClientPreview] = useState<ClientPlanPreview | null>(
    null
  );
  const [llmInput, setLlmInput] = useState<LlmPlanInput | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [highContrastMap, setHighContrastMap] = useState(false);
  const [crimeIncidents, setCrimeIncidents] = useState<CrimeIncident[]>([]);
  const [crimeMeta, setCrimeMeta] = useState<CrimeIncidentMeta | null>(null);
  const [crimeLayerVisible, setCrimeLayerVisible] = useState(false);
  const [crimeLoading, setCrimeLoading] = useState(false);
  const [crimeError, setCrimeError] = useState<string | null>(null);
  const { location: gpsLocation } = useGeolocation(true);
  const voiceRef = useRef<VoicePanelHandle>(null);
  const cameraRef = useRef<CameraPanelHandle>(null);
  const planningInFlightRef = useRef(false);

  const preference: UserPreference = {
    profile,
    priority,
    ...(customNotes.trim() ? { customNotes: customNotes.trim() } : {}),
  };
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
    setLlmInput(null);
    clearRecommendationUpdated();
    clearError();

    const planPreference: UserPreference = {
      profile: options.profileOverride ?? profile,
      priority,
      ...(customNotes.trim() ? { customNotes: customNotes.trim() } : {}),
    };

    if (options.profileOverride && options.profileOverride !== profile) {
      setProfile(options.profileOverride);
    }

    if (options.audioInput) {
      setPlanClientPreview({
        trigger: "voice",
        audioInput: options.audioInput,
        journey: options.journey,
        preference: {
          profile: planPreference.profile,
          priority: planPreference.priority,
          ...(planPreference.customNotes
            ? { customNotes: planPreference.customNotes }
            : {}),
        },
      });
      voiceRef.current?.notifyPlanningStarted(
        options.journey?.start && options.journey?.destination
          ? {
              start: options.journey.start,
              destination: options.journey.destination,
            }
          : undefined
      );
    } else if (options.journey?.start && options.journey?.destination) {
      setPlanClientPreview({
        trigger: "form",
        journey: options.journey,
        preference: {
          profile: planPreference.profile,
          priority: planPreference.priority,
          ...(planPreference.customNotes
            ? { customNotes: planPreference.customNotes }
            : {}),
        },
      });
    } else {
      setPlanClientPreview(null);
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
      setSelectedRouteId(result.recommendation.recommendedRouteId);
      setRecommendation(result.recommendation);
      setRouteExplanation(result.explanation);
      const sent = result.meta.llmInput ?? result.meta.geminiInput;
      if (sent) {
        setLlmInput(sent);
      }
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
      setProfile(voiceIntent.profile);
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

  async function handleSimulateEvent(eventType: CityEventType) {
    if (!compared) return;
    setAgentLoading(true);
    clearRecommendationUpdated();
    const result = await simulateEvent(
      eventType,
      {
        gps: gpsLocation,
        cameraData,
        preference,
        journey: { start: start.trim(), destination: destination.trim() },
      },
      recommendation
    );
    if (result.recommendation) setRecommendation(result.recommendation);
    if (result.explanation) setRouteExplanation(result.explanation);
    if (result.explanation && result.recommendation) {
      voiceRef.current?.announceRouteExplanation(
        result.explanation,
        result.recommendation,
        {
          journey: { start: start.trim(), destination: destination.trim() },
          preference: {
            profile: preference.profile,
            priority: preference.priority,
          },
        }
      );
    }
    setAgentLoading(false);
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

  const busy = agentLoading || isSearching || isSimulating;
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
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">
                    User Profile
                  </span>
                  <select
                    value={profile}
                    onChange={(e) =>
                      setProfile(e.target.value as UserPreference["profile"])
                    }
                    className={inputClass}
                  >
                    {USER_PROFILES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {profile === "general" && (
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                      No fixed accessibility persona — your{" "}
                      <span className="text-cyan-400/90">Preference</span> drives
                      route ranking and recommendations.
                    </p>
                  )}
                </label>
                {profile === "custom" && (
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
                    {profile === "general" || profile === "custom" ? (
                      <span className="ml-1 text-cyan-500/80">· primary</span>
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
                    : agentLoading && !isSimulating
                      ? "Analysing…"
                      : "Compare Routes"}
                </button>
              </div>
            </div>

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

            {compared && (
              <EventSimulator
                onSimulate={handleSimulateEvent}
                disabled={!compared || !!fetchError}
                loading={busy}
              />
            )}

            {(compared || agentLoading || planClientPreview || llmInput) && (
              <GeminiInputPanel
                loading={agentLoading || isSearching}
                clientPreview={planClientPreview}
                llmInput={llmInput}
              />
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

            {timeline.length > 0 && <ChangeTimeline entries={timeline} />}
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
                  <button
                    type="button"
                    onClick={handleCrimeMapToggle}
                    disabled={crimeLoading}
                    className="rounded-md border border-orange-400/40 bg-orange-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-orange-100 transition hover:border-orange-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-pressed={crimeLayerVisible}
                  >
                    {crimeLoading
                      ? "Loading crime map…"
                      : crimeLayerVisible
                        ? "Hide crime map"
                        : crimeIncidents.length > 0
                          ? "Show crime map"
                          : "Load crime map"}
                  </button>
                </div>
              )}
            </div>

            {showMap ? (
              <RouteMap
                routes={mobilityRoutes}
                selectedRouteId={highlightedRouteId}
                onRouteSelect={setSelectedRouteId}
                startLabel={start || "Start"}
                endLabel={destination || "Destination"}
                highContrast={highContrastMap}
                crimeIncidents={crimeLayerVisible ? crimeIncidents : []}
                crimeMeta={crimeLayerVisible ? crimeMeta : null}
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
                {routes.map((route) => (
                  <RouteCard
                    key={route.routeId}
                    route={route}
                    isRecommended={route.routeId === recommendedId}
                    prevSignals={prevSignals[route.routeId]}
                    isSelected={route.routeId === highlightedRouteId}
                    onSelect={() => setSelectedRouteId(route.routeId)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
