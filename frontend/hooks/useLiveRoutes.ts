"use client";

import { useCallback, useState } from "react";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent";
import { generateMobilityRecommendation } from "@/lib/agent";
import type { AccessibilitySignals, EnrichedRoute } from "@/lib/accessibility/types";
import {
  getEventTimelineMessages,
} from "@/lib/events/simulator";
import {
  createTimelineEntry,
  type CityEventType,
  type TimelineEntry,
} from "@/lib/events/types";
import { mobilityStatesToEnriched } from "@/lib/mobilityAdapter";
import { rankRoutes } from "@/lib/recommendation";
import type { MobilityRouteState } from "@/lib/mobilityEngine";

export interface RoutesMeta {
  source: "tfl";
  from: string;
  to: string;
  count: number;
  profile?: UserPreference["profile"];
  osmWarning?: string;
}

export interface FetchRoutesResult {
  routes: EnrichedRoute[];
  mobilityRoutes: MobilityRouteState[];
  meta: RoutesMeta;
}

export function useLiveRoutes() {
  const [routes, setRoutes] = useState<EnrichedRoute[]>([]);
  const [mobilityRoutes, setMobilityRoutes] = useState<MobilityRouteState[]>(
    []
  );
  const [routesMeta, setRoutesMeta] = useState<RoutesMeta | null>(null);
  const [prevSignals, setPrevSignals] = useState<
    Record<string, AccessibilitySignals>
  >({});
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [recommendationUpdated, setRecommendationUpdated] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const cvFeed: {
    routeId: string;
    observation: { crowdDensity: number; obstacleDensity: number; crossingVisibility: number };
    evidence: string[];
  }[] = [];

  const fetchRoutes = useCallback(
    async (
      from: string,
      to: string,
      profile: UserPreference["profile"] = "general",
      priority: UserPreference["priority"] = "most_accessible",
      customNotes?: string
    ): Promise<FetchRoutesResult> => {
      setIsSearching(true);
      setFetchError(null);
      setCanRetry(false);

      try {
        const res = await fetch("/api/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, profile }),
        });

        const data = (await res.json()) as {
          routes?: MobilityRouteState[];
          meta?: RoutesMeta;
          error?: string;
        };

        if (!res.ok) {
          setCanRetry(true);
          throw new Error(data.error ?? `Route fetch failed (${res.status})`);
        }

        if (!data.routes?.length) {
          setCanRetry(true);
          throw new Error("No routes returned from TfL");
        }

        const enriched = mobilityStatesToEnriched(data.routes);
        const rankedIds = rankRoutes(enriched, {
          profile,
          priority,
          ...(customNotes ? { customNotes } : {}),
        });
        const sorted = rankedIds
          .map((id) => enriched.find((r) => r.routeId === id))
          .filter((r): r is EnrichedRoute => r !== undefined);
        const mobilitySorted = rankedIds
          .map((id) => data.routes!.find((r) => r.id === id))
          .filter((r): r is MobilityRouteState => r !== undefined);

        setMobilityRoutes(mobilitySorted.length ? mobilitySorted : data.routes);
        setRoutes(sorted.length ? sorted : enriched);
        setRoutesMeta(
          data.meta ?? { source: "tfl", from, to, count: data.routes.length, profile }
        );

        return {
          routes: enriched,
          mobilityRoutes: data.routes,
          meta: data.meta!,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch routes";
        setFetchError(message);
        throw err;
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  const pushTimeline = useCallback((entries: TimelineEntry[]) => {
    setTimeline((prev) => [...entries, ...prev].slice(0, 20));
  }, []);

  const capturePrevSignals = useCallback((currentRoutes: EnrichedRoute[]) => {
    const snap: Record<string, AccessibilitySignals> = {};
    for (const r of currentRoutes) snap[r.routeId] = { ...r.signals };
    setPrevSignals(snap);
  }, []);

  const detectScoreChanges = useCallback(
    (oldRoutes: EnrichedRoute[], newRoutes: EnrichedRoute[]) => {
      const changes: { routeId: string; label: string; delta: number }[] = [];
      for (const nr of newRoutes) {
        const old = oldRoutes.find((r) => r.routeId === nr.routeId);
        if (!old) continue;
        const fields: (keyof AccessibilitySignals)[] = [
          "accessibility",
          "stress",
          "reliability",
          "predictability",
        ];
        for (const f of fields) {
          const delta = nr.signals[f] - old.signals[f];
          if (delta !== 0) {
            changes.push({
              routeId: nr.routeId,
              label: f.charAt(0).toUpperCase() + f.slice(1),
              delta,
            });
          }
        }
      }
      return changes;
    },
    []
  );

  const simulateEvent = useCallback(
    async (
      eventType: CityEventType,
      preference: UserPreference,
      journey: { start: string; destination: string },
      currentRecommendation: MobilityRecommendation | null
    ) => {
      setIsSimulating(true);
      setRecommendationUpdated(false);

      const oldRoutes = routes;
      capturePrevSignals(oldRoutes);

      // Re-fetch live TfL data after simulated disruption
      let newRoutes = oldRoutes;
      try {
        const result = await fetchRoutes(
          journey.start,
          journey.destination,
          preference.profile,
          preference.priority,
          preference.customNotes
        );
        newRoutes = result.routes;
      } catch {
        newRoutes = oldRoutes;
      }

      const scoreChanges = detectScoreChanges(oldRoutes, newRoutes);
      const oldRecId = currentRecommendation?.recommendedRouteId;

      let newRecommendation: MobilityRecommendation | null = null;
      if (journey.start && journey.destination) {
        newRecommendation = await generateMobilityRecommendation({
          routes: newRoutes,
          preference,
          journey,
        });
      }

      const recChanged =
        !!oldRecId &&
        !!newRecommendation &&
        oldRecId !== newRecommendation.recommendedRouteId;

      if (recChanged) setRecommendationUpdated(true);

      const { event, followUps } = getEventTimelineMessages(
        eventType,
        scoreChanges,
        recChanged,
        newRecommendation?.recommendedRouteId
      );

      pushTimeline([
        createTimelineEntry(event, "warning"),
        ...followUps.map((msg) =>
          createTimelineEntry(
            msg,
            msg.includes("Recommendation") ? "critical" : "info"
          )
        ),
      ]);

      setTimeout(() => {
        const synced: Record<string, AccessibilitySignals> = {};
        for (const r of newRoutes) synced[r.routeId] = { ...r.signals };
        setPrevSignals(synced);
      }, 2400);

      setIsSimulating(false);
      return { routes: newRoutes, recommendation: newRecommendation, recChanged };
    },
    [routes, capturePrevSignals, detectScoreChanges, pushTimeline, fetchRoutes]
  );

  const clearRecommendationUpdated = useCallback(() => {
    setRecommendationUpdated(false);
  }, []);

  const clearError = useCallback(() => {
    setFetchError(null);
    setCanRetry(false);
  }, []);

  return {
    routes,
    mobilityRoutes,
    routesMeta,
    cvFeed,
    prevSignals,
    timeline,
    recommendationUpdated,
    isSimulating,
    isSearching,
    fetchError,
    canRetry,
    fetchRoutes,
    simulateEvent,
    clearRecommendationUpdated,
    clearError,
  };
}
