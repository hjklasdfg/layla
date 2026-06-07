"use client";

import { useCallback, useRef, useState } from "react";
import {
  SpatialAudioPlayer,
  type ChannelLevels,
  type SoundPosition,
} from "@/lib/navigation/spatial-audio";

interface AlertOptions {
  /** If true, play a simple beep at the position even if TTS is available.
   *  Useful when the alert is purely a directional cue, no words needed. */
  beepOnly?: boolean;
}

export interface UseSpatialAlertResult {
  /** Speak (or beep) at a 2D position. Resolves when the audio ends. */
  alert: (text: string, position: SoundPosition, opts?: AlertOptions) => Promise<void>;
  /** True if the most recent /api/voice/speak call returned a TTS audio blob.
   *  False when we had to fall back to a beep (no ELEVENLABS_API_KEY). */
  ttsAvailable: boolean | null;
  /** Last user-facing error message, if any. */
  error: string | null;
  /** True while audio is playing. */
  speaking: boolean;
  /** Read current L/R audio levels (call from a rAF / setInterval). */
  readLevels: () => ChannelLevels;
}

export function useSpatialAlert(): UseSpatialAlertResult {
  const playerRef = useRef<SpatialAudioPlayer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const ensurePlayer = useCallback((): SpatialAudioPlayer => {
    if (playerRef.current) return playerRef.current;
    // Must be called from a user gesture (button click) for autoplay policy.
    const AC: typeof AudioContext =
      window.AudioContext ??
      // @ts-expect-error webkit prefix on older Safari
      window.webkitAudioContext;
    if (!AC) throw new Error("Web Audio API not supported in this browser");
    const ctx = new AC();
    ctxRef.current = ctx;
    playerRef.current = new SpatialAudioPlayer(ctx);
    return playerRef.current;
  }, []);

  const alert = useCallback(
    async (text: string, position: SoundPosition, opts?: AlertOptions) => {
      setError(null);
      let player: SpatialAudioPlayer;
      try {
        player = ensurePlayer();
        if (ctxRef.current?.state === "suspended") {
          await ctxRef.current.resume();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Audio context failed");
        return;
      }

      setSpeaking(true);
      try {
        if (opts?.beepOnly) {
          await player.playBeep(position);
          return;
        }

        // Try ElevenLabs TTS via existing endpoint
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (res.ok) {
          const bytes = await res.arrayBuffer();
          if (bytes.byteLength > 0) {
            setTtsAvailable(true);
            await player.playBytes(bytes, position);
            return;
          }
        }

        // Fallback: spatial beep so the demo still proves directionality
        setTtsAvailable(false);
        await player.playBeep(position);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Spatial playback failed");
      } finally {
        setSpeaking(false);
      }
    },
    [ensurePlayer]
  );

  const readLevels = useCallback((): ChannelLevels => {
    if (!playerRef.current) return { l: 0, r: 0 };
    return playerRef.current.getLevels();
  }, []);

  return { alert, ttsAvailable, error, speaking, readLevels };
}
