"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import { useCameraStream } from "@/hooks/useCameraStream";
import type { GpsLocation } from "@/lib/mobility/sensors";
import type { HazardReportResult } from "@/lib/camera/types";

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

  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<HazardReportResult | null>(null);

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

  const handleReportHazard = useCallback(async () => {
    setReportLoading(true);
    setError(null);
    setReport(null);

    try {
      const { base64, mimeType } = await capturePhoto();
      const res = await fetch("/api/camera/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          gps,
          locationDescription,
        }),
      });

      const payload = (await res.json()) as HazardReportResult & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "Hazard report failed");
      }

      setReport(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hazard report failed");
    } finally {
      setReportLoading(false);
    }
  }, [capturePhoto, gps, locationDescription, setError]);

  return (
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
          onClick={() => void handleReportHazard()}
          disabled={reportLoading}
          className="rounded-lg bg-violet-500/20 px-3 py-2.5 text-xs font-semibold text-violet-100 ring-1 ring-violet-400/30 transition hover:bg-violet-500/30 disabled:opacity-50"
        >
          {reportLoading ? "Analyzing…" : "Report hazard (photo)"}
        </button>
      </div>

      <p className="text-[11px] leading-snug text-slate-500">
        Recording uploads 5s chunks to your backend. Photo report uses Gemini vision +
        web search to find the right authority and draft/send an email.
      </p>

      {error && (
        <div className="rounded bg-red-900/40 p-2 text-xs text-red-300">{error}</div>
      )}

      {report && (
        <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-slate-300">
          <p className="font-medium text-violet-200">
            {report.analysis.hazardType} · {report.analysis.severity}
          </p>
          <p>{report.analysis.description}</p>
          <p className="text-slate-400">{report.analysis.accessibilityImpact}</p>
          <p>
            <span className="text-slate-500">Authority:</span>{" "}
            {report.authority.organization}
            {report.authority.email ? ` · ${report.authority.email}` : ""}
          </p>
          {report.authority.reportUrl && (
            <a
              href={report.authority.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-cyan-400 underline"
            >
              Official report form
            </a>
          )}
          <p className="text-slate-500">{report.emailStatus}</p>
          <details className="text-slate-400">
            <summary className="cursor-pointer text-slate-500">Draft email</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px]">
              To: {report.email.to}
              {"\n"}Subject: {report.email.subject}
              {"\n\n"}
              {report.email.body}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export const CameraPanel = forwardRef(CameraPanelInner);
