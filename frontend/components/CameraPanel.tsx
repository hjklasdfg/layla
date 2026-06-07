"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { HazardReportModal } from "@/components/HazardReportModal";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useVoiceSpeak } from "@/hooks/useVoiceSpeak";
import type { HazardStreamResult } from "@/lib/camera/hazard-stream";
import { hazardCarefulVoiceText } from "@/lib/camera/surroundings";
import type { GpsLocation } from "@/lib/mobility/sensors";

export interface CameraPanelHandle {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

interface CameraPanelProps {
  gps?: GpsLocation | null;
  locationDescription?: string;
}

const CAREFUL_VOICE_COOLDOWN_MS = 15_000;

function hazardModeLabel(mode: string | null): string {
  if (!mode || mode === "demo" || mode === "yolo") return "live";
  return mode;
}

function HazardOverlay({ result }: { result: HazardStreamResult | null }) {
  if (!result?.hazards.length) return null;

  const closeThreshold = result.meta?.stopThreshold ?? 0.9;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden
    >
      {result.hazards.map((hazard, index) => {
        const { x1, y1, x2, y2 } = hazard.bbox;
        const isClosest = index === 0;
        const stroke =
          isClosest && hazard.proximity >= closeThreshold ? "#f87171" : "#fbbf24";
        return (
          <rect
            key={`${index}-${hazard.proximity}`}
            x={x1}
            y={y1}
            width={Math.max(0, x2 - x1)}
            height={Math.max(0, y2 - y1)}
            fill="none"
            stroke={stroke}
            strokeWidth={0.004}
          />
        );
      })}
    </svg>
  );
}

function CameraPanelInner(
  { gps, locationDescription }: CameraPanelProps,
  ref: Ref<CameraPanelHandle>
) {
  const lastCarefulVoiceAtRef = useRef(0);
  const { speak, unlockAudio } = useVoiceSpeak();

  const handleHazardResult = useCallback(
    (result: HazardStreamResult) => {
      const voiceText = hazardCarefulVoiceText(result);
      if (!voiceText) return;
      const now = Date.now();
      if (now - lastCarefulVoiceAtRef.current < CAREFUL_VOICE_COOLDOWN_MS) return;
      lastCarefulVoiceAtRef.current = now;
      void unlockAudio().then(() => speak(voiceText));
    },
    [speak, unlockAudio]
  );

  const {
    videoRef,
    active,
    recording,
    analyzing,
    warmingUp,
    hazardMode,
    error,
    lastCapture,
    hazardResult,
    startCamera,
    stopCamera,
    startRecording,
    stopRecording,
    capturePhoto,
    setError,
  } = useCameraStream({ gps, onHazardResult: handleHazardResult });

  const [hazardModalOpen, setHazardModalOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    startRecording: async () => {
      await startRecording();
    },
    stopRecording: () => {
      stopRecording();
    },
    startCamera,
    stopCamera,
  }));

  const handleToggleRecording = useCallback(async () => {
    if (recording) {
      stopRecording();
      return;
    }
    await startRecording();
  }, [recording, startRecording, stopRecording]);

  const handleOpenHazardReport = useCallback(() => {
    setError(null);
    setHazardModalOpen(true);
  }, [setError]);

  const handleHazardStart = useCallback(async () => {
    const { base64, mimeType } = await capturePhoto();
    return {
      imageBase64: base64,
      mimeType,
      gps,
      locationDescription,
    };
  }, [capturePhoto, gps, locationDescription]);

  const isFakeLoop = hazardMode === "fake-loop" || hazardResult?.faked === true;
  const modelLabel = hazardResult?.meta?.model;

  return (
    <>
      <div className="space-y-3 rounded-xl border border-pink-500/25 bg-pink-950/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-pink-300">
            Live hazard watch
          </h2>
          {(warmingUp || recording) && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              {warmingUp
                ? "Starting service…"
                : analyzing
                  ? "Analyzing…"
                  : isFakeLoop
                    ? "Loop test (fake bboxes)"
                    : hazardResult?.meta?.inferenceMs != null
                        ? `YOLO · ${hazardResult.meta.inferenceMs}ms`
                        : hazardMode
                          ? `Live · ${hazardModeLabel(hazardMode)}`
                          : "Live · active"}
            </span>
          )}
        </div>

        {isFakeLoop && recording && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            Camera video is real, but hazard boxes are <strong>synthetic</strong>. Set{" "}
            <code className="text-amber-200">CAMERA_HAZARD_FAKE_LOOP=false</code> and point{" "}
            <code className="text-amber-200">CAMERA_HAZARD_API_URL</code> at your Spark, then
            restart <code className="text-amber-200">npm run dev</code>.
          </div>
        )}

        {!isFakeLoop && hazardResult?.forwarded && modelLabel && (
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Model: {modelLabel}
            {hazardResult.meta?.inferenceMs != null && ` · ${hazardResult.meta.inferenceMs}ms`}
          </p>
        )}

        <div className="relative overflow-hidden rounded-lg border border-slate-700/60 bg-black/40">
          <video
            ref={videoRef}
            className="aspect-video w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <HazardOverlay result={hazardResult} />
          {!active && (
            <p className="px-3 py-2 text-center text-[11px] text-slate-500">
              Say “turn on the camera” or tap Record below
            </p>
          )}
        </div>

        {hazardResult?.surroundings?.summary && (
          <div
            className="rounded-lg border border-slate-600/50 bg-slate-900/50 px-3 py-2"
            aria-live="polite"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Surroundings
            </p>
            <p className="mt-1 text-sm leading-snug text-slate-100">
              {hazardResult.surroundings.summary}
            </p>
          </div>
        )}

        {lastCapture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lastCapture}
            alt="Last captured street frame"
            className="max-h-28 w-full rounded-lg border border-slate-700/60 object-cover"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleToggleRecording()}
            className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition ${
              recording
                ? "bg-red-500/20 text-red-200 ring-1 ring-red-400/40"
                : "bg-pink-500/15 text-pink-100 hover:bg-pink-500/25"
            }`}
          >
            {recording ? "End live watch" : "Start live watch"}
          </button>
          <button
            type="button"
            onClick={handleOpenHazardReport}
            className="rounded-lg bg-violet-500/20 px-3 py-2.5 text-xs font-semibold text-violet-100 ring-1 ring-violet-400/30 transition hover:bg-violet-500/30"
          >
            Report hazard (photo)
          </button>
        </div>

        <p className="text-[11px] leading-snug text-slate-500">
          Sends camera frames every ~300ms to your YOLO backend.
        </p>

        {error && (
          <div className="rounded bg-red-900/40 p-2 text-xs text-red-300">{error}</div>
        )}
      </div>

      <HazardReportModal
        open={hazardModalOpen}
        onClose={() => setHazardModalOpen(false)}
        onStart={handleHazardStart}
      />
    </>
  );
}

export const CameraPanel = forwardRef(CameraPanelInner);
