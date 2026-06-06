"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GpsLocation } from "@/lib/mobility/sensors";

const CHUNK_MS = 5_000;

interface UseCameraStreamOptions {
  gps?: GpsLocation | null;
  onUploadError?: (message: string) => void;
}

export function useCameraStream(options: UseCameraStreamOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkIndexRef = useRef(0);

  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const uploadChunk = useCallback(
    async (blob: Blob, index: number) => {
      const formData = new FormData();
      formData.append("chunk", blob, `camera-chunk-${index}.webm`);
      formData.append("chunkIndex", String(index));
      formData.append("timestamp", new Date().toISOString());
      if (options.gps) {
        formData.append("gps", JSON.stringify(options.gps));
      }

      const res = await fetch("/api/camera/stream", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? "Camera upload failed");
      }
    },
    [options.gps]
  );

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
        await videoRef.current.play();
      }
      setActive(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not access camera";
      setError(message);
      throw err;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (recorderRef.current?.state !== "inactive") {
      recorderRef.current?.stop();
    }
    recorderRef.current = null;
    setRecording(false);
    stopTracks();
    setActive(false);
  }, [stopTracks]);

  const startRecording = useCallback(async () => {
    if (!streamRef.current) {
      await startCamera();
    }

    const stream = streamRef.current;
    if (!stream) return;

    if (recorderRef.current?.state === "recording") return;

    chunkIndexRef.current = 0;
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm",
    });

    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const index = chunkIndexRef.current;
      chunkIndexRef.current += 1;
      void uploadChunk(event.data, index).catch((err) => {
        const message = err instanceof Error ? err.message : "Upload failed";
        setError(message);
        options.onUploadError?.(message);
      });
    };

    recorder.onerror = () => {
      setError("Recording error");
    };

    recorder.start(CHUNK_MS);
    recorderRef.current = recorder;
    setRecording(true);
    setError(null);
  }, [startCamera, uploadChunk, options.onUploadError]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const capturePhoto = useCallback(async (): Promise<{ base64: string; mimeType: string }> => {
    if (!streamRef.current) {
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
  }, [startCamera]);

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state !== "inactive") {
        recorderRef.current?.stop();
      }
      stopTracks();
    };
  }, [stopTracks]);

  return {
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
  };
}
