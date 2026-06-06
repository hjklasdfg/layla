"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { CommitStrategy, useScribe } from "@elevenlabs/react";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import type { RouteExplanation } from "@/lib/mobility/plan";
import { buildSpeakLinesFromPlan } from "@/lib/voice/speak-script";
import { shouldTriggerMobilityPlan } from "@/lib/mobility/voice-intent";
import { useVoiceSpeak } from "@/hooks/useVoiceSpeak";
import {
  appendVoiceMessage,
  loadVoiceMemory,
  saveVoicePlanMemory,
} from "@/lib/voice/conversation-memory";
import { getVoiceUserId } from "@/lib/voice/user-id";

export interface VoicePanelHandle {
  announceRouteExplanation: (
    explanation: RouteExplanation,
    recommendation: MobilityRecommendation,
    options?: {
      journey?: { start: string; destination: string };
      preference?: Pick<UserPreference, "profile" | "priority">;
    }
  ) => void;
  notifyPlanningStarted: (journey?: { start: string; destination: string }) => void;
  notifySpeechReceived: (
    text: string,
    journey?: { start?: string; destination?: string }
  ) => void;
  notifyPlanningFailed: (message: string) => void;
  notifyHeardButNoJourney: () => void;
}

function statusLabel(
  connected: boolean,
  connecting: boolean,
  isListening: boolean,
  isSpeaking: boolean,
  isPlanning: boolean,
  micDenied: boolean
): string {
  if (micDenied) return "Microphone needed — tap to allow access";
  if (connecting) return "Connecting mic…";
  if (isPlanning) return "Planning route…";
  if (isSpeaking) return "Speaking Layla recommendation…";
  if (isListening) return "Listening — tap again when finished";
  if (connected) return "Tap mic to start speaking";
  return "Tap mic to start";
}

function micButtonClasses(
  connected: boolean,
  connecting: boolean,
  isListening: boolean,
  isSpeaking: boolean,
  isPlanning: boolean
): string {
  const base =
    "mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60";

  if (connecting) {
    return `${base} border-slate-600 bg-slate-800 text-slate-300`;
  }

  if (isPlanning) {
    return `${base} border-blue-400/50 bg-blue-500/15 text-blue-200 animate-pulse`;
  }

  if (isSpeaking) {
    return `${base} border-violet-400 bg-violet-500/20 text-violet-200 animate-pulse`;
  }

  if (isListening) {
    return `${base} border-red-400/70 bg-red-500/15 text-red-200 animate-pulse`;
  }

  if (connected) {
    return `${base} border-cyan-400/50 bg-slate-800 text-cyan-200 hover:border-cyan-400 hover:bg-cyan-500/10`;
  }

  return `${base} border-slate-600 bg-slate-800 text-slate-200 hover:border-cyan-500/50 hover:bg-slate-700`;
}

function VoicePanelPlaceholder() {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
        Voice Guide
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        Add{" "}
        <span className="font-mono text-slate-400">ELEVENLABS_API_KEY</span> and set{" "}
        <span className="font-mono text-slate-400">NEXT_PUBLIC_VOICE_ENABLED=true</span> in
        .env.local
      </p>
    </div>
  );
}

function isBenignScribeCloseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("1006") ||
    normalized.includes("1000") ||
    normalized.includes("1005") ||
    normalized.includes("user ended session") ||
    normalized.includes("websocket closed")
  );
}

/** VAD mode auto-commits — wait for silence before disconnect (see vadSilenceThresholdSecs). */
const VAD_FLUSH_MS = 1300;

const VoicePanelActive = forwardRef<
  VoicePanelHandle,
  { onUserSpeech?: (text: string) => void }
>(function VoicePanelActive({ onUserSpeech }, ref) {
  const userIdRef = useRef<string>("");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [livePartial, setLivePartial] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [scribeError, setScribeError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const listeningBufferRef = useRef<string[]>([]);
  const lastUserSpeechRef = useRef("");
  const unmountedRef = useRef(false);
  const scribeRef = useRef<ReturnType<typeof useScribe> | null>(null);
  const intentionalCloseRef = useRef(false);
  const acceptingTranscriptRef = useRef(false);
  const livePartialRef = useRef("");
  const lastSpokenRef = useRef("");
  const onUserSpeechRef = useRef(onUserSpeech);

  const { speak, speakLines, unlockAudio, isSpeaking, speakError, clearSpeakError } =
    useVoiceSpeak();

  onUserSpeechRef.current = onUserSpeech;

  const setListening = useCallback((listening: boolean) => {
    isListeningRef.current = listening;
    setIsListening(listening);
  }, []);

  const dispatchUserSpeech = useCallback((text: string) => {
    const final = text.trim();
    if (!final || final === lastUserSpeechRef.current) return;
    lastUserSpeechRef.current = final;
    onUserSpeechRef.current?.(final);
  }, []);

  const disconnectScribe = useCallback(async () => {
    const activeScribe = scribeRef.current;
    if (!activeScribe?.isConnected) return;

    intentionalCloseRef.current = true;
    try {
      activeScribe.disconnect();
    } catch {
      // ignore disconnect errors
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, []);

  const stopListening = useCallback(async () => {
    if (!isListeningRef.current) return;

    setIsListening(false);
    setLivePartial("");
    acceptingTranscriptRef.current = true;

    const activeScribe = scribeRef.current;
    const pendingPartial = livePartialRef.current.trim();

    if (activeScribe?.isConnected) {
      intentionalCloseRef.current = true;
      // VAD commits automatically — do not call commit() (can trigger abnormal close).
      await new Promise((resolve) => setTimeout(resolve, VAD_FLUSH_MS));
      try {
        activeScribe.disconnect();
      } catch {
        // ignore disconnect errors
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    acceptingTranscriptRef.current = false;
    isListeningRef.current = false;
    livePartialRef.current = "";

    let combined = listeningBufferRef.current.join(" ").trim();
    if (!combined && pendingPartial) {
      combined = pendingPartial;
    }
    listeningBufferRef.current = [];

    if (combined) {
      setTranscript((prev) => [...prev.slice(-6), `you: ${combined}`]);
      appendVoiceMessage(userIdRef.current, "user", combined);
      dispatchUserSpeech(combined);
    }
  }, [dispatchUserSpeech]);

  const handleCommittedTranscript = useCallback((text: string) => {
    const final = text.trim();
    if (!final) return;

    setLivePartial("");
    livePartialRef.current = "";
    listeningBufferRef.current.push(final);
  }, []);

  const handleScribeError = useCallback((err: unknown) => {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" &&
            err !== null &&
            "error" in err &&
            typeof (err as { error?: unknown }).error === "string"
          ? (err as { error: string }).error
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message?: unknown }).message === "string"
            ? (err as { message: string }).message
            : "Voice connection failed";

    // ElevenLabs SDK logs 1006 on normal mic teardown — not a user-facing failure.
    if (isBenignScribeCloseError(message)) {
      return;
    }
    if (intentionalCloseRef.current) {
      return;
    }

    setConnecting(false);
    isListeningRef.current = false;
    acceptingTranscriptRef.current = false;
    setIsListening(false);
    setScribeError(message);
  }, []);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 1.2,
    vadThreshold: 0.45,
    minSpeechDurationMs: 150,
    minSilenceDurationMs: 800,
    languageCode: "en",
    onPartialTranscript: ({ text }) => {
      if (!isListeningRef.current) return;
      const partial = text.trim();
      livePartialRef.current = partial;
      setLivePartial(partial);
    },
    onCommittedTranscript: ({ text }) => {
      if (!isListeningRef.current && !acceptingTranscriptRef.current) return;
      handleCommittedTranscript(text);
    },
    onError: handleScribeError,
    onAuthError: (data) => {
      handleScribeError(new Error(data.error ?? "Scribe authentication failed"));
    },
    onUnacceptedTermsError: (data) => {
      handleScribeError(
        new Error(
          data.error ??
            "Accept ElevenLabs Scribe terms in your ElevenLabs dashboard, then retry."
        )
      );
    },
    onDisconnect: () => {
      isListeningRef.current = false;
      acceptingTranscriptRef.current = false;
      setIsListening(false);
      setConnecting(false);
      intentionalCloseRef.current = false;
    },
    onSessionStarted: () => {
      intentionalCloseRef.current = false;
      setScribeError(null);
    },
  });

  scribeRef.current = scribe;

  const announceRouteExplanation = useCallback(
    async (
      explanation: RouteExplanation,
      recommendation: MobilityRecommendation,
      options?: {
        journey?: { start: string; destination: string };
        preference?: Pick<UserPreference, "profile" | "priority">;
      }
    ) => {
      setIsPlanning(false);
      void stopListening();

      const lines = buildSpeakLinesFromPlan(explanation, recommendation);
      if (!lines.length) return;

      if (options?.journey) {
        saveVoicePlanMemory(userIdRef.current, {
          journey: options.journey,
          recommendedRouteId: recommendation.recommendedRouteId,
          explanation,
          preference: options.preference,
        });
      }

      for (const line of lines) {
        appendVoiceMessage(userIdRef.current, "agent", line);
        setTranscript((prev) => [...prev.slice(-6), `layla: ${line}`]);
      }

      lastSpokenRef.current = lines.join(" ");
      clearSpeakError();
      await unlockAudio();
      await speakLines(lines);
    },
    [clearSpeakError, speakLines, stopListening, unlockAudio]
  );

  const notifySpeechReceived = useCallback(
    (text: string, journey?: { start?: string; destination?: string }) => {
      if (!shouldTriggerMobilityPlan(text)) return;

      setIsPlanning(true);
      const line =
        journey?.start && journey?.destination
          ? `Got it. Checking routes from ${journey.start} to ${journey.destination}.`
          : "Got it. Checking routes now.";

      setTranscript((prev) => [...prev.slice(-6), `layla: ${line}`]);
      lastSpokenRef.current = line;
      clearSpeakError();
      void unlockAudio().then(() => speak(line));
    },
    [clearSpeakError, speak, unlockAudio]
  );

  const notifyPlanningStarted = useCallback(
    (journey?: { start: string; destination: string }) => {
      setIsPlanning(true);
      const line = journey
        ? `layla: Planning ${journey.start} → ${journey.destination}…`
        : "layla: Planning…";
      setTranscript((prev) => [...prev.slice(-6), line]);
    },
    []
  );

  const notifyHeardButNoJourney = useCallback(() => {
    setTranscript((prev) => [
      ...prev.slice(-6),
      "layla: (say “from King's Cross to Victoria” to plan a journey)",
    ]);
  }, []);

  const notifyPlanningFailed = useCallback(
    async (message: string) => {
      setIsPlanning(false);
      const spoken = `Sorry, I could not plan that journey. ${message}`;
      appendVoiceMessage(userIdRef.current, "agent", spoken);
      setTranscript((prev) => [...prev.slice(-6), `layla: ${spoken}`]);
      clearSpeakError();
      await unlockAudio();
      await speak(spoken);
    },
    [clearSpeakError, speak, unlockAudio]
  );

  useImperativeHandle(
    ref,
    () => ({
      announceRouteExplanation: (explanation, recommendation, options) => {
        void announceRouteExplanation(explanation, recommendation, options);
      },
      notifyPlanningStarted: (journey) => {
        notifyPlanningStarted(journey);
      },
      notifySpeechReceived: (text, journey) => {
        notifySpeechReceived(text, journey);
      },
      notifyPlanningFailed: (message) => {
        void notifyPlanningFailed(message);
      },
      notifyHeardButNoJourney,
    }),
    [
      announceRouteExplanation,
      notifyPlanningStarted,
      notifySpeechReceived,
      notifyPlanningFailed,
      notifyHeardButNoJourney,
    ]
  );

  const connectScribe = useCallback(async () => {
    if (unmountedRef.current) return false;

    setConnecting(true);
    setMicDenied(false);
    setScribeError(null);

    if (!userIdRef.current) {
      userIdRef.current = getVoiceUserId();
    }

    loadVoiceMemory(userIdRef.current);

    try {
      if (scribe.isConnected) {
        await disconnectScribe();
      }

      await unlockAudio();

      const tokenRes = await fetch("/api/voice/scribe-token");
      if (!tokenRes.ok) {
        const payload = (await tokenRes.json()) as { error?: string };
        throw new Error(payload.error ?? "Could not get Scribe token");
      }

      const { token } = (await tokenRes.json()) as { token: string };

      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start voice";
      if (message.toLowerCase().includes("permission")) {
        setMicDenied(true);
      } else {
        setScribeError(message);
      }
      return false;
    } finally {
      setConnecting(false);
    }
  }, [disconnectScribe, scribe, unlockAudio]);

  const startListening = useCallback(async () => {
    if (isPlanning || isSpeaking || isListeningRef.current) return;

    listeningBufferRef.current = [];
    setLivePartial("");

    const ok = await connectScribe();
    if (!ok) return;

    setListening(true);
  }, [connectScribe, isPlanning, isSpeaking, setListening]);

  useEffect(() => {
    userIdRef.current = getVoiceUserId();
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      intentionalCloseRef.current = true;
      scribeRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const isConnected = scribe.isConnected;
  const speaking = isSpeaking || isPlanning;

  const handleMicPress = useCallback(() => {
    void unlockAudio();

    if (isListening) {
      void stopListening();
      return;
    }

    void startListening();
  }, [isListening, startListening, stopListening, unlockAudio]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
          Voice Guide
        </h2>
        <div className="flex items-center gap-2">
          {isListening && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-40" />
              <span className="relative h-2 w-2 rounded-full bg-red-400" />
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              isListening
                ? "bg-red-500/10 text-red-300"
                : "bg-slate-700/50 text-slate-500"
            }`}
          >
            {isListening ? "Recording" : "Ready"}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleMicPress}
        disabled={connecting || isPlanning || isSpeaking}
        className={micButtonClasses(
          isConnected,
          connecting,
          isListening,
          isSpeaking,
          isPlanning
        )}
        aria-label={isListening ? "Stop and send speech" : "Start speaking"}
        aria-pressed={isListening}
      >
        <span className="text-2xl" aria-hidden>
          {connecting ? "…" : isListening ? "⏹" : "🎙"}
        </span>
      </button>

      <p className="text-center text-sm text-slate-400">
        {statusLabel(
          isConnected,
          connecting,
          isListening,
          isSpeaking,
          isPlanning,
          micDenied
        )}
      </p>

      {speaking && (
        <div className="flex items-end justify-center gap-1 py-1" aria-hidden>
          {[0, 1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className="w-1 animate-pulse rounded-full bg-cyan-400/80"
              style={{
                height: `${10 + (bar % 3) * 6}px`,
                animationDelay: `${bar * 120}ms`,
              }}
            />
          ))}
        </div>
      )}

      {livePartial && isListening && (
        <p className="text-center text-xs italic text-slate-500">…{livePartial}</p>
      )}

      {transcript.length > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto text-xs text-slate-500">
          {transcript.map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
        </div>
      )}

      {scribeError && (
        <div className="rounded border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">
          <p>{scribeError}</p>
          <button
            type="button"
            onClick={() => setScribeError(null)}
            className="mt-2 rounded-md border border-red-400/50 px-2 py-1 font-medium text-red-100 hover:bg-red-900/40"
          >
            Dismiss
          </button>
        </div>
      )}

      {speakError && (
        <div className="rounded border border-amber-500/40 bg-amber-950/30 p-2 text-xs text-amber-200">
          <p>Voice playback blocked — tap Replay.</p>
          {lastSpokenRef.current && (
            <button
              type="button"
              onClick={() => {
                void unlockAudio().then(() => speak(lastSpokenRef.current));
              }}
              className="mt-2 rounded-md border border-amber-400/50 px-2 py-1 font-medium text-amber-100 hover:bg-amber-900/40"
            >
              Replay last message
            </button>
          )}
        </div>
      )}

      <p className="pt-1 text-center text-[10px] text-slate-600">
        Tap 🎙 to speak · tap ⏹ when done · instant ack, then route result
      </p>
    </div>
  );
});

export const VoicePanel = forwardRef<
  VoicePanelHandle,
  { onUserSpeech?: (text: string) => void }
>(function VoicePanel({ onUserSpeech }, ref) {
  const voiceEnabled =
    process.env.NEXT_PUBLIC_VOICE_ENABLED === "true" ||
    Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);
  if (!voiceEnabled) return <VoicePanelPlaceholder />;
  return <VoicePanelActive ref={ref} onUserSpeech={onUserSpeech} />;
});
