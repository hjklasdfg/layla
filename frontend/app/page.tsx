"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { CameraPanel, type CameraPanelHandle } from "@/components/CameraPanel";
import { isCameraOffCommand, isCameraOnCommand } from "@/lib/camera/voice-commands";
import { ChangeTimeline } from "@/components/ChangeTimeline";
import { GeminiInputPanel, type ClientPlanPreview } from "@/components/GeminiInputPanel";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import { MobilityAgentPanel } from "@/components/MobilityAgentPanel";
import { AskLaylaPanel } from "@/components/AskLaylaPanel";
import { NavigationPanel } from "@/components/NavigationPanel";
import { VoicePanel, type VoicePanelHandle } from "@/components/VoicePanel";
import { RouteCard } from "@/components/RouteCard";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import { PRIORITY_LABELS, PROFILE_LABELS } from "@/lib/agent/types";
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
import { useVoiceSpeak } from "@/hooks/useVoiceSpeak";
import type { MobilityRouteState } from "@/lib/mobilityEngine";

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
  const [personaRoutes, setPersonaRoutes] = useState<MobilityRouteState[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareDim, setCompareDim] = useState<"profile" | "preference">("profile");
  const [cmpProfiles, setCmpProfiles] = useState<UserPreference["profile"][]>([
    "general",
    "blind",
    "wheelchair",
  ]);
  const [cmpPrefs, setCmpPrefs] = useState<UserPreference["priority"][]>([
    "most_accessible",
    "fastest",
    "most_reliable",
  ]);
  const [highContrastMap, setHighContrastMap] = useState(false);
  const [crimeIncidents, setCrimeIncidents] = useState<CrimeIncident[]>([]);
  const [crimeMeta, setCrimeMeta] = useState<CrimeIncidentMeta | null>(null);
  const [crimeLayerVisible, setCrimeLayerVisible] = useState(false);
  const [crimeLoading, setCrimeLoading] = useState(false);
  const [crimeError, setCrimeError] = useState<string | null>(null);
  const { location: gpsLocation } = useGeolocation(true);
  const nav = useNavigation();
  const { speak: speakAnswer } = useVoiceSpeak();
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
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
    priorityOverride?: UserPreference["priority"];
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
      priority: options.priorityOverride ?? priority,
      ...(customNotes.trim() ? { customNotes: customNotes.trim() } : {}),
    };

    if (options.profileOverride && options.profileOverride !== profile) {
      setProfile(options.profileOverride);
    }
    if (options.priorityOverride && options.priorityOverride !== priority) {
      setPriority(options.priorityOverride);
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
    setPersonaRoutes([]); // leave persona-overlay mode
    setCompareError(null);
    await runPlan({
      journey: {
        start: start.trim(),
        destination: destination.trim(),
      },
    });
  }

  async function handleComparePersonas() {
    if (!start.trim() || !destination.trim()) return;
    const combos =
      compareDim === "profile"
        ? cmpProfiles.map((p) => ({ profile: p, priority }))
        : cmpPrefs.map((pr) => ({ profile, priority: pr }));
    if (!combos.length) {
      setCompareError("Pick at least one option to compare.");
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/mobility/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey: { start: start.trim(), destination: destination.trim() },
          combos,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `compare failed (${res.status})`);
      }
      setPersonaRoutes((data.routes as MobilityRouteState[]) ?? []);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : "Persona compare failed");
      setPersonaRoutes([]);
    } finally {
      setCompareLoading(false);
    }
  }

  async function fetchNemotronIntent(text: string): Promise<{
    kind?: "route" | "question";
    start?: string;
    destination?: string;
    profile?: UserPreference["profile"];
    priority?: UserPreference["priority"];
  } | null> {
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      const d = await res.json();
      return d.error ? null : d;
    } catch {
      return null;
    }
  }

  async function askLayla(question: string) {
    const text = question.trim();
    if (!text || askLoading) return;
    setAskQuestion(text);
    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `ask failed (${res.status})`);
      setAskAnswer(d.answer || "(no answer)");
      void speakAnswer(d.answer || "");
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "ask failed");
    } finally {
      setAskLoading(false);
    }
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

    // Nemotron parses the utterance (local on the Spark); regex parse as fallback.
    const ai = await fetchNemotronIntent(text);
    if (ai?.kind === "question") {
      // a general question -> answer it aloud (not a journey)
      void askLayla(text);
      return;
    }
    const regex = parseVoiceIntent(text);
    const profilePick = ai?.profile ?? regex.profile;
    const priorityPick = ai?.priority;
    const rawStart = ai?.start || regex.journey.start;
    const destination = ai?.destination || regex.journey.destination;

    // "from my current location / here" -> the device's GPS coordinates
    let start = rawStart;
    let displayStart = rawStart;
    if (
      rawStart &&
      /current location|my location|where i am|from here|near me|my position/i.test(rawStart)
    ) {
      if (gpsLocation) {
        start = `${gpsLocation.latitude.toFixed(6)},${gpsLocation.longitude.toFixed(6)}`;
        displayStart = "your location";
      } else {
        voiceRef.current?.notifyPlanningFailed(
          "I couldn't get your location — enable location access and try again."
        );
        return;
      }
    }

    if (profilePick) setProfile(profilePick);
    if (priorityPick) setPriority(priorityPick);

    const hasJourney = Boolean(start && destination);
    if (!hasJourney) {
      // Not a journey -> answer it as a general question (Ask Layla), spoken aloud.
      void askLayla(text);
      return;
    }

    if (planningInFlightRef.current) return;

    voiceRef.current?.notifySpeechReceived(text, { start: displayStart, destination });

    void runPlan({
      audioInput: text,
      profileOverride: profilePick,
      priorityOverride: priorityPick,
      journey: { start, destination },
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

  const busy = agentLoading || isSearching || isSimulating;
  const showMap = mobilityRoutes.length > 0 || personaRoutes.length > 0;

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

            <AskLaylaPanel
              question={askQuestion}
              onQuestionChange={setAskQuestion}
              onAsk={askLayla}
              answer={askAnswer}
              loading={askLoading}
              error={askError}
            />

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
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-slate-400">From</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (gpsLocation) {
                          setStart(
                            `${gpsLocation.latitude.toFixed(6)},${gpsLocation.longitude.toFixed(6)}`
                          );
                        }
                      }}
                      disabled={!gpsLocation}
                      title={
                        gpsLocation
                          ? "Use your current GPS location"
                          : "Location unavailable (needs GPS + HTTPS)"
                      }
                      className="text-[11px] font-medium text-cyan-400 transition hover:text-cyan-300 disabled:cursor-not-allowed disabled:text-slate-600"
                    >
                      📍 Use my location
                    </button>
                  </div>
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
                <div className="space-y-2 rounded-lg border border-cyan-500/30 bg-slate-900/40 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                    Compare on map
                  </p>
                  <div className="flex gap-1 rounded-md bg-slate-800/60 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setCompareDim("profile")}
                      className={`flex-1 rounded px-2 py-1 transition ${
                        compareDim === "profile"
                          ? "bg-cyan-500 font-semibold text-slate-950"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      By profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareDim("preference")}
                      className={`flex-1 rounded px-2 py-1 transition ${
                        compareDim === "preference"
                          ? "bg-cyan-500 font-semibold text-slate-950"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      By preference
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {compareDim === "profile"
                      ? `Preference fixed: ${
                          PREFERENCES.find((p) => p.value === priority)?.label ?? priority
                        }`
                      : `Profile fixed: ${
                          USER_PROFILES.find((p) => p.value === profile)?.label ?? profile
                        }`}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {compareDim === "profile"
                      ? USER_PROFILES.filter((o) => o.value !== "custom").map((opt) => (
                          <label
                            key={opt.value}
                            className="flex items-center gap-1.5 text-xs text-slate-300"
                          >
                            <input
                              type="checkbox"
                              checked={cmpProfiles.includes(opt.value)}
                              onChange={(e) =>
                                setCmpProfiles((prev) =>
                                  e.target.checked
                                    ? [...prev, opt.value]
                                    : prev.filter((v) => v !== opt.value)
                                )
                              }
                            />
                            {opt.label}
                          </label>
                        ))
                      : PREFERENCES.map((opt) => (
                          <label
                            key={opt.value}
                            className="flex items-center gap-1.5 text-xs text-slate-300"
                          >
                            <input
                              type="checkbox"
                              checked={cmpPrefs.includes(opt.value)}
                              onChange={(e) =>
                                setCmpPrefs((prev) =>
                                  e.target.checked
                                    ? [...prev, opt.value]
                                    : prev.filter((v) => v !== opt.value)
                                )
                              }
                            />
                            {opt.label}
                          </label>
                        ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleComparePersonas}
                    disabled={!start.trim() || !destination.trim() || compareLoading}
                    className="w-full rounded-lg border border-cyan-500/40 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {compareLoading ? "Loading…" : "Show on map"}
                  </button>
                  {personaRoutes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPersonaRoutes([])}
                      className="w-full text-[11px] text-slate-500 hover:text-slate-300"
                    >
                      Clear comparison
                    </button>
                  )}
                  {compareError && (
                    <p className="text-[11px] text-red-300">{compareError}</p>
                  )}
                </div>
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
                </div>
              )}
            </div>

            {showMap ? (
              <RouteMap
                routes={personaRoutes.length ? personaRoutes : mobilityRoutes}
                selectedRouteId={personaRoutes.length ? null : highlightedRouteId}
                onRouteSelect={setSelectedRouteId}
                startLabel={start || "Start"}
                endLabel={destination || "Destination"}
                highContrast={highContrastMap}
                crimeIncidents={crimeLayerVisible ? crimeIncidents : []}
                crimeMeta={crimeLayerVisible ? crimeMeta : null}
                livePosition={nav.isNavigating ? nav.lastGps : null}
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
