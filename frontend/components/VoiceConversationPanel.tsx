"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation, useConversationClientTool } from "@elevenlabs/react";

/**
 * ElevenLabs Conversational AI voice panel (full-duplex). Rendered only when
 * NEXT_PUBLIC_VOICE_MODE=conversational and an agent id is configured; the
 * legacy Scribe push-to-talk panel handles every other case.
 *
 * Flow:  mic -> ElevenLabs ConvAI (WS, VAD/STT/TTS) -> Custom-LLM webhook
 *        /api/voice/chat -> OpenClaw agent. Map intents arrive as client-tool
 *        calls (show_routes / highlight_route / show_hazard) that the agent's
 *        LLM emits and ElevenLabs invokes here in the browser.
 *
 * Map updates are dispatched as a window CustomEvent ("layla:voice-map-command")
 * AND via the optional onMapCommand prop, so RouteMap/page can subscribe without
 * this component depending on their internals.
 */

export type VoiceMapCommand =
  | { command: "show_routes"; from: string; to: string }
  | { command: "highlight_route"; routeId: string }
  | { command: "show_hazard"; lat: number; lng: number; label: string };

interface Props {
  onMapCommand?: (cmd: VoiceMapCommand) => void;
}

function dispatchMapCommand(cmd: VoiceMapCommand, onMapCommand?: (c: VoiceMapCommand) => void) {
  onMapCommand?.(cmd);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("layla:voice-map-command", { detail: cmd }));
  }
}

// Browsers create AudioContexts in a "suspended" state and only allow audio
// playback after a user gesture. The ElevenLabs SDK builds its output
// AudioContext inside startSession() and tries to resume it itself — but if any
// `await` runs between the click and startSession() (e.g. fetching a signed
// URL), the user activation is consumed and the resume is rejected on strict
// engines (iOS Safari especially). The result: the agent's reply audio arrives
// over the WebSocket but is never played. Resuming a context synchronously on
// the click marks the document as user-activated for audio so the SDK's own
// resume() succeeds. Best-effort — failures are non-fatal.
let sharedPlaybackCtx: AudioContext | null = null;
function unlockAudioPlayback() {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!sharedPlaybackCtx) sharedPlaybackCtx = new Ctx();
    if (sharedPlaybackCtx.state === "suspended") void sharedPlaybackCtx.resume();
    // A 1-sample silent buffer satisfies stricter autoplay engines.
    const source = sharedPlaybackCtx.createBufferSource();
    source.buffer = sharedPlaybackCtx.createBuffer(1, 1, 22050);
    source.connect(sharedPlaybackCtx.destination);
    source.start(0);
  } catch {
    /* best-effort; the SDK still attempts its own resume */
  }
}

export function VoiceConversationPanel({ onMapCommand }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [lastUtterance, setLastUtterance] = useState<string>("");
  // Cached signed URL so startSession() can run synchronously inside the click
  // gesture (no `await fetch` in the start path — see unlockAudioPlayback).
  const signedUrlRef = useRef<string | null>(null);

  const conversation = useConversation({
    onConnect: () => setError(null),
    onError: (message: string) => setError(message || "Voice connection error"),
    onMessage: ({ message, source }: { message: string; source: string }) => {
      if (source === "user") setLastUtterance(message);
    },
  });

  // Pre-mint the signed URL ahead of the click. The agent is private, so we
  // start from a server-minted signed URL when available; null means fall back
  // to the provider's default agent id (public agent).
  const refreshSignedUrl = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/session");
      const data = (await res.json()) as { signedUrl?: string | null };
      signedUrlRef.current = data.signedUrl ?? null;
    } catch {
      signedUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshSignedUrl();
  }, [refreshSignedUrl]);

  // Map tools — names MUST match the client tools configured on the ElevenLabs
  // agent. Handlers receive untyped params (Record<string, unknown>); we read
  // the fields defensively.
  useConversationClientTool("show_routes", (p: Record<string, unknown>) => {
    dispatchMapCommand(
      { command: "show_routes", from: String(p.from ?? ""), to: String(p.to ?? "") },
      onMapCommand,
    );
    return "ok";
  });
  useConversationClientTool("highlight_route", (p: Record<string, unknown>) => {
    dispatchMapCommand(
      { command: "highlight_route", routeId: String(p.routeId ?? "") },
      onMapCommand,
    );
    return "ok";
  });
  useConversationClientTool("show_hazard", (p: Record<string, unknown>) => {
    dispatchMapCommand(
      {
        command: "show_hazard",
        lat: Number(p.lat ?? 0),
        lng: Number(p.lng ?? 0),
        label: String(p.label ?? ""),
      },
      onMapCommand,
    );
    return "ok";
  });

  const status = conversation.status; // "disconnected" | "connecting" | "connected"
  const active = status === "connected" || status === "connecting";

  const toggle = useCallback(() => {
    if (active) {
      void conversation.endSession();
      void refreshSignedUrl(); // re-arm for the next session
      return;
    }
    setError(null);
    // Everything below must stay synchronous within the click gesture so the
    // SDK's output AudioContext is created+resumed while the page is still
    // user-activated — otherwise the agent's audio is received but never plays.
    try {
      unlockAudioPlayback();
      const url = signedUrlRef.current;
      // startSession() from the react hook returns void and runs the async
      // setup (mic, audio context) internally; SDK errors surface via onError.
      conversation.startSession(url ? { signedUrl: url } : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start voice";
      setError(msg.toLowerCase().includes("permission") ? "Microphone access needed." : msg);
    }
  }, [active, conversation, refreshSignedUrl]);

  const label = error
    ? "Tap to retry"
    : status === "connecting"
      ? "Connecting…"
      : conversation.isSpeaking
        ? "Layla is speaking…"
        : status === "connected"
          ? "Listening — just talk"
          : "Tap to start talking";

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
          Voice Guide
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            status === "connected" ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/50 text-slate-500"
          }`}
        >
          {status === "connected" ? "Live" : "Idle"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={status === "connecting"}
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
          conversation.isSpeaking
            ? "border-violet-400 bg-violet-500/20 text-violet-200 animate-pulse"
            : active
              ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-200 animate-pulse"
              : "border-slate-600 bg-slate-800 text-slate-200 hover:border-cyan-500/50 hover:bg-slate-700"
        }`}
        aria-label={active ? "End voice conversation" : "Start voice conversation"}
        aria-pressed={active}
      >
        <span className="text-2xl" aria-hidden>
          {status === "connecting" ? "…" : active ? "⏹" : "🎙"}
        </span>
      </button>

      <p className="text-center text-sm text-slate-400">{label}</p>

      {lastUtterance && (
        <p className="text-center text-xs italic text-slate-500">“{lastUtterance}”</p>
      )}

      {error && (
        <div className="rounded border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 rounded-md border border-red-400/50 px-2 py-1 font-medium text-red-100 hover:bg-red-900/40"
          >
            Dismiss
          </button>
        </div>
      )}

      <p className="pt-1 text-center text-[10px] text-slate-600">
        Continuous voice · speak naturally · powered by the NemoClaw agent
      </p>
    </div>
  );
}
