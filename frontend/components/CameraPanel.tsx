"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import { HazardReportModal } from "@/components/HazardReportModal";
import { useCameraStream } from "@/hooks/useCameraStream";
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

function CameraPanelInner(
  { gps, locationDescription }: CameraPanelProps,
  ref: Ref<CameraPanelHandle>
) {
  const {
    videoRef,
    active,
    recording,
    error,
    lastCapture,
    startCamera,
    stopCamera,
    startRecording,
    stopRecording,
    capturePhoto,
    setError,
  } = useCameraStream({ gps });

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

  return (
    <>
      <div className="space-y-3 rounded-xl border border-pink-500/25 bg-pink-950/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-pink-300">
            Street Camera
          </h2>
          {recording && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              Recording → backend
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-700/60 bg-black/40">
          <video
            ref={videoRef}
            className="aspect-video w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          {!active && (
            <p className="px-3 py-2 text-center text-[11px] text-slate-500">
              Say “turn on the camera” or tap Record below
            </p>
          )}
        </div>

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
            {recording ? "Stop recording" : "Start recording"}
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
          Uses NEBUISAI_API_KEY only: vision hazard detection, GPS lookup, web
          search for authority email, email draft — click Send when ready.
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
