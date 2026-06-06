"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useVoiceSpeak } from "@/hooks/useVoiceSpeak";
import {
  initNavigationState,
  tickNavigation,
} from "@/lib/navigation/engine";
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
  startNavigation: (coordinates: [number, number][]) => Promise<void>;
  stopNavigation: () => void;
}

export function useNavigation(): UseNavigationResult {
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentManeuverIndex, setCurrentManeuverIndex] = useState(0);
  const [distanceToNextM, setDistanceToNextM] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [gpsTicks, setGpsTicks] = useState(0);
  const [lastGps, setLastGps] = useState<UseNavigationResult["lastGps"]>(null);

  const navStateRef = useRef<NavigationState | null>(null);
  const { location, error: rawGpsError } = useGeolocation(isNavigating);
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

  const startNavigation = useCallback(
    async (coordinates: [number, number][]) => {
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start navigation");
      } finally {
        setLoading(false);
      }
    },
    [unlockAudio]
  );

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    stopSpeak();
    navStateRef.current = null;
  }, [stopSpeak]);

  // Real GPS → engine
  useEffect(() => {
    if (!isNavigating || !location) return;
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
    gpsError: isNavigating ? rawGpsError : null,
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
