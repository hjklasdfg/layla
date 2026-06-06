"use client";

import { useCallback, useRef, useState } from "react";

/** Minimal silent WAV — unlocks autoplay after mic permission. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

let sharedAudioContext: AudioContext | null = null;

async function resumeAudioContext(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContext();
    }
    if (sharedAudioContext.state === "suspended") {
      await sharedAudioContext.resume();
    }
  } catch {
    // ignore — HTML Audio fallback still available
  }
}

function speakWithBrowserTts(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Browser speech synthesis unavailable"));
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Browser speech synthesis failed"));
    window.speechSynthesis.speak(utterance);
  });
}

export function useVoiceSpeak() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);

  const unlockAudio = useCallback(async () => {
    await resumeAudioContext();
    try {
      const silent = new Audio(SILENT_WAV);
      silent.volume = 0.001;
      await silent.play();
      unlockedRef.current = true;
    } catch {
      // Retry on each speak — autoplay may work after user gesture.
    }
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setIsSpeaking(false);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speakOnce = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      stop();
      setSpeakError(null);
      await unlockAudio();

      let usedFallback = false;

      try {
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });

        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onplay = () => setIsSpeaking(true);
            audio.onended = () => {
              setIsSpeaking(false);
              URL.revokeObjectURL(url);
            };
            audio.onerror = () => {
              setIsSpeaking(false);
              URL.revokeObjectURL(url);
            };

            try {
              await audio.play();
              return;
            } catch {
              URL.revokeObjectURL(url);
              audioRef.current = null;
            }
          }
        }

        usedFallback = true;
        setIsSpeaking(true);
        await speakWithBrowserTts(trimmed);
        setIsSpeaking(false);
      } catch (err) {
        setIsSpeaking(false);
        const message =
          err instanceof Error ? err.message : "Could not play voice response";
        setSpeakError(message);

        if (!usedFallback && "speechSynthesis" in window) {
          try {
            setIsSpeaking(true);
            await speakWithBrowserTts(trimmed);
            setIsSpeaking(false);
            setSpeakError(null);
          } catch {
            setIsSpeaking(false);
          }
        }
      }
    },
    [stop, unlockAudio]
  );

  const speak = useCallback(
    async (text: string) => {
      await speakOnce(text);
    },
    [speakOnce]
  );

  /** Speak each line in order — used when plan JSON arrives with follow-up content. */
  const speakLines = useCallback(
    async (lines: string[]) => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        await speakOnce(trimmed);
      }
    },
    [speakOnce]
  );

  return {
    speak,
    speakLines,
    stop,
    unlockAudio,
    isSpeaking,
    speakError,
    clearSpeakError: () => setSpeakError(null),
  };
};
