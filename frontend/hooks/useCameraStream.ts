"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HazardStreamResult } from "@/lib/camera/hazard-stream";
import type { GpsLocation } from "@/lib/mobility/sensors";

const FRAME_MS = Number(process.env.NEXT_PUBLIC_CAMERA_HAZARD_FRAME_MS) || 300;
const MAX_FRAME_WIDTH = Number(process.env.NEXT_PUBLIC_CAMERA_HAZARD_FRAME_WIDTH) || 640;
const JPEG_QUALITY = 0.72;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function safePlay(video: HTMLVideoElement): Promise<void> {
  if (!video.srcObject) return;
  try {
    await video.play();
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }
}

interface UseCameraStreamOptions {
  gps?: GpsLocation | null;
  onUploadError?: (message: string) => void;
  onHazardResult?: (result: HazardStreamResult) => void;
}

export function useCameraStream(options: UseCameraStreamOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const frameIndexRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [hazardResult, setHazardResult] = useState<HazardStreamResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [warmingUp, setWarmingUp] = useState(false);
  const [hazardMode, setHazardMode] = useState<string | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const uploadFrame = useCallback(
    async (blob: Blob, index: number) => {
      const formData = new FormData();
      formData.append("frame", blob, `camera-frame-${index}.jpg`);
      formData.append("frameIndex", String(index));
      formData.append("timestamp", new Date().toISOString());
      if (options.gps) {
        formData.append("gps", JSON.stringify(options.gps));
      }

      const res = await fetch("/api/camera/frame", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? "Camera upload failed");
      }

      const payload = (await res.json()) as HazardStreamResult & {
        forwarded?: boolean;
        faked?: boolean;
      };
      if (Array.isArray(payload.hazards)) {
        setHazardResult(payload);
        options.onHazardResult?.(payload);
      }
    },
    [options.gps, options.onHazardResult]
  );

  const captureAndUploadFrame = useCallback(async () => {
    if (inFlightRef.current) return;

    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const scale = Math.min(1, MAX_FRAME_WIDTH / srcW);
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    inFlightRef.current = true;
    setAnalyzing(true);
    const index = frameIndexRef.current;
    frameIndexRef.current += 1;

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Could not encode frame"))),
          "image/jpeg",
          JPEG_QUALITY
        );
      });
      await uploadFrame(blob, index);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      options.onUploadError?.(message);
    } finally {
      inFlightRef.current = false;
      setAnalyzing(false);
    }
  }, [uploadFrame, options.onUploadError]);

  const startCamera = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await safePlay(videoRef.current);
      }
      setActive(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not access camera";
      setError(message);
      throw err;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (frameLoopRef.current !== null) {
      clearInterval(frameLoopRef.current);
      frameLoopRef.current = null;
    }
    inFlightRef.current = false;
    setRecording(false);
    setAnalyzing(false);
    setWarmingUp(false);
    stopTracks();
    setActive(false);
  }, [stopTracks]);

  const stopCamera = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  const ensureHazardService = useCallback(async () => {
    setWarmingUp(true);
    setError(null);
    try {
      const res = await fetch("/api/camera/hazard/start", { method: "POST" });
      const payload = (await res.json()) as {
        error?: string;
        mode?: string;
        demo?: boolean;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not start live hazard watch service");
      }
      setHazardMode(payload.mode ?? (payload.demo ? "demo" : "yolo"));
    } finally {
      setWarmingUp(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!active) {
      await startCamera();
    }

    if (frameLoopRef.current !== null) return;

    await ensureHazardService();

    frameIndexRef.current = 0;
    setRecording(true);
    setError(null);

    frameLoopRef.current = setInterval(() => {
      void captureAndUploadFrame();
    }, FRAME_MS);
    void captureAndUploadFrame();
  }, [active, startCamera, captureAndUploadFrame, ensureHazardService]);

  const capturePhoto = useCallback(async (): Promise<{ base64: string; mimeType: string }> => {
    if (!active) {
      await startCamera();
    }

    const video = videoRef.current;
    if (!video) {
      throw new Error("Camera preview not ready");
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not capture frame");

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setLastCapture(dataUrl);

    const [header, base64] = dataUrl.split(",");
    const mimeType = header?.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
    if (!base64) throw new Error("Invalid capture data");

    return { base64, mimeType };
  }, [active, startCamera]);

  useEffect(() => {
    return () => {
      if (frameLoopRef.current !== null) {
        clearInterval(frameLoopRef.current);
      }
      stopTracks();
    };
  }, [stopTracks]);

  return {
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
  };
}
