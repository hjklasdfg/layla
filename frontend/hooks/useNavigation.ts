"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useVoiceSpeak } from "@/hooks/useVoiceSpeak";
import {
  initNavigationState,
  tickNavigation,
} from "@/lib/navigation/engine";
import { distanceMeters } from "@/lib/navigation/geo";
import { extractNavRoute } from "@/lib/navigation/extract";
import type {
  GpsTick,
  NavRoute,
  NavigationState,
} from "@/lib/navigation/types";

/** Detect coordinate convention for London-ish data.
 *  TfL / OSM mix [lng, lat] and [lat, lng]. For London:
 *  lat ≈ 51.x  (so |first| > 30 means it's lat)
 *  lng ≈ -0.x  (so |first| < 1 means it's lng)
 */
function normalizeToShape(
  coords: [number, number][]
): Array<{ lat: number; lng: number }> {
  if (coords.length === 0) return [];
  const [a] = coords[0];
  const firstLooksLikeLat = Math.abs(a) > 30 && Math.abs(a) < 90;
  return coords.map(([x, y]) =>
    firstLooksLikeLat ? { lat: x, lng: y } : { lat: y, lng: x }
  );
}

export interface UseNavigationResult {
  isNavigating: boolean;
  loading: boolean;
  error: string | null;
  /** Error from the browser's Geolocation API, surfaced only while navigating. */
  gpsError: string | null;
  route: NavRoute | null;
  currentManeuverIndex: number;
  distanceToNextM: number | null;
  arrived: boolean;
  gpsTicks: number;
  lastGps: { lat: number; lng: number; accuracy?: number } | null;
  startNavigation: (
    coordinates: [number, number][],
    opts?: { simulate?: boolean }
  ) => Promise<void>;
  stopNavigation: () => void;
}

export function useNavigation(): UseNavigationResult {
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentManeuverIndex, setCurrentManeuverIndex] = useState(0);
  const [distanceToNextM, setDistanceToNextM] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [gpsTicks, setGpsTicks] = useState(0);
  const [lastGps, setLastGps] = useState<UseNavigationResult["lastGps"]>(null);

  const navStateRef = useRef<NavigationState | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simulatingRef = useRef(false);
  const { location, error: rawGpsError } = useGeolocation(isNavigating && !simulating);
  const { speak, unlockAudio, stop: stopSpeak } = useVoiceSpeak();

  const processGps = useCallback(
    (gps: GpsTick) => {
      if (!navStateRef.current) return;
      const { newState, events } = tickNavigation(navStateRef.current, gps);
      navStateRef.current = newState;
      setLastGps({ lat: gps.lat, lng: gps.lng, accuracy: gps.accuracyM });
      setGpsTicks((c) => c + 1);

      for (const ev of events) {
        switch (ev.kind) {
          case "speak":
            void speak(ev.text);
            break;
          case "advance":
            setCurrentManeuverIndex(ev.toIndex);
            break;
          case "progress":
            setDistanceToNextM(ev.distanceToNextManeuverM);
            setCurrentManeuverIndex(ev.currentManeuverIndex);
            break;
          case "arrived":
            setArrived(true);
            setIsNavigating(false);
            break;
        }
      }
    },
    [speak]
  );

  // Demo mode: drive a virtual position along the route geometry so turn-by-turn
  // voice fires on a stationary laptop (no real GPS movement). 8 m steps stay
  // under the engine's 18 m alert band so no cue is skipped.
  const startSim = useCallback(
    (path: Array<{ lat: number; lng: number }>) => {
      if (simRef.current) clearInterval(simRef.current);
      let segIdx = 0;
      let segProg = 0;
      const STEP_M = 8;
      const TICK_MS = 280;
      processGps({ lat: path[0].lat, lng: path[0].lng, accuracyM: 5, timestamp: Date.now() });
      simRef.current = setInterval(() => {
        let remaining = STEP_M;
        while (remaining > 0 && segIdx < path.length - 1) {
          const segLen = distanceMeters(path[segIdx], path[segIdx + 1]);
          if (segLen <= 0) {
            segIdx += 1;
            segProg = 0;
            continue;
          }
          if (segProg + remaining < segLen) {
            segProg += remaining;
            remaining = 0;
          } else {
            remaining -= segLen - segProg;
            segIdx += 1;
            segProg = 0;
          }
        }
        if (segIdx >= path.length - 1) {
          const last = path[path.length - 1];
          processGps({ lat: last.lat, lng: last.lng, accuracyM: 5, timestamp: Date.now() });
          if (simRef.current) {
            clearInterval(simRef.current);
            simRef.current = null;
          }
          return;
        }
        const a = path[segIdx];
        const b = path[segIdx + 1];
        const segLen = distanceMeters(a, b);
        const f = segLen > 0 ? segProg / segLen : 0;
        processGps({
          lat: a.lat + (b.lat - a.lat) * f,
          lng: a.lng + (b.lng - a.lng) * f,
          accuracyM: 5,
          timestamp: Date.now(),
        });
      }, TICK_MS);
    },
    [processGps]
  );

  const startNavigation = useCallback(
    async (coordinates: [number, number][], opts?: { simulate?: boolean }) => {
      if (!coordinates || coordinates.length < 2) {
        setError("Route has no usable geometry to navigate.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const shape = normalizeToShape(coordinates);
        const res = await fetch("/api/navigation/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shape }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? `HTTP ${res.status}`);
        }
        const valhalla = await res.json();
        const navRoute = extractNavRoute(valhalla);
        if (navRoute.maneuvers.length === 0) {
          throw new Error("Valhalla returned no maneuvers for this path.");
        }
        setRoute(navRoute);
        navStateRef.current = initNavigationState(navRoute, Date.now());
        setCurrentManeuverIndex(0);
        setDistanceToNextM(null);
        setArrived(false);
        setGpsTicks(0);
        setLastGps(null);
        await unlockAudio();
        setIsNavigating(true);
        if (opts?.simulate) {
          simulatingRef.current = true;
          setSimulating(true);
          startSim(normalizeToShape(coordinates));
        } else {
          simulatingRef.current = false;
          setSimulating(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start navigation");
      } finally {
        setLoading(false);
      }
    },
    [unlockAudio, startSim]
  );

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    stopSpeak();
    navStateRef.current = null;
    simulatingRef.current = false;
    setSimulating(false);
    if (simRef.current) {
      clearInterval(simRef.current);
      simRef.current = null;
    }
  }, [stopSpeak]);

  // Real GPS → engine
  useEffect(() => {
    if (!isNavigating || !location || simulatingRef.current) return;
    processGps({
      lat: location.latitude,
      lng: location.longitude,
      accuracyM: location.accuracy,
      timestamp: location.timestamp,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, isNavigating]);

  return {
    isNavigating,
    loading,
    error,
    gpsError: isNavigating && !simulating ? rawGpsError : null,
    route,
    currentManeuverIndex,
    distanceToNextM,
    arrived,
    gpsTicks,
    lastGps,
    startNavigation,
    stopNavigation,
  };
}
