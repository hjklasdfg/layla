"use client";

import { useCallback, useState } from "react";
import type { MobilityRecommendation, UserPreference } from "@/lib/agent/types";
import type { AccessibilitySignals, EnrichedRoute } from "@/lib/accessibility/types";
import { getEventTimelineMessages } from "@/lib/events/simulator";
import {
  createTimelineEntry,
  type CityEventType,
  type TimelineEntry,
} from "@/lib/events/types";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";
import type { MobilityPlanRequest, RouteExplanation } from "@/lib/mobility/plan";
import { planMobilityJourney } from "@/lib/mobility/plan";
import type { MobilityRouteState } from "@/lib/mobilityEngine";

export interface RoutesMeta {
  source: "tfl" | "backend" | "local";
  from: string;
  to: string;
  count: number;
  profile?: UserPreference["profile"];
  osmWarning?: string;
  startPoint?: import("@/lib/mobility/backend-plan-types").JourneyMapPoint;
  endPoint?: import("@/lib/mobility/backend-plan-types").JourneyMapPoint;
  llmInput?: LlmPlanInput;
  /** @deprecated use llmInput */
  geminiInput?: LlmPlanInput;
}

export function useLiveRoutes() {
  const [routes, setRoutes] = useState<EnrichedRoute[]>([]);
  const [mobilityRoutes, setMobilityRoutes] = useState<MobilityRouteState[]>([]);
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

  const pushTimeline = useCallback((entries: TimelineEntry[]) => {
    setTimeline((prev) => [...entries, ...prev].slice(0, 20));
  }, []);

  const capturePrevSignals = useCallback((currentRoutes: EnrichedRoute[]) => {
    const snap: Record<string, AccessibilitySignals> = {};
    for (const route of currentRoutes) snap[route.routeId] = { ...route.signals };
    setPrevSignals(snap);
  }, []);

  const detectScoreChanges = useCallback(
    (oldRoutes: EnrichedRoute[], newRoutes: EnrichedRoute[]) => {
      const changes: { routeId: string; label: string; delta: number }[] = [];
      for (const nr of newRoutes) {
        const old = oldRoutes.find((route) => route.routeId === nr.routeId);
        if (!old) continue;
        const fields: (keyof AccessibilitySignals)[] = [
          "accessibility",
          "stress",
          "reliability",
          "predictability",
        ];
        for (const field of fields) {
          const delta = nr.signals[field] - old.signals[field];
          if (delta !== 0) {
            changes.push({
              routeId: nr.routeId,
              label: field.charAt(0).toUpperCase() + field.slice(1),
              delta,
            });
          }
        }
      }
      return changes;
    },
    []
  );

  const applyPlanResult = useCallback(
    (result: Awaited<ReturnType<typeof planMobilityJourney>>) => {
      setMobilityRoutes(result.routes);
      setRoutes(result.enrichedRoutes);
      setRoutesMeta(result.meta);
      return result;
    },
    []
  );

  const runMobilityPlan = useCallback(
    async (
      request: MobilityPlanRequest
    ): Promise<{
      recommendation: MobilityRecommendation;
      journey: { start: string; destination: string };
      explanation: RouteExplanation;
      meta: RoutesMeta;
    }> => {
      setIsSearching(true);
      setFetchError(null);
      setCanRetry(false);
      setMobilityRoutes([]);
      setRoutes([]);
      setRoutesMeta(null);

      try {
        const result = applyPlanResult(await planMobilityJourney(request));
        return {
          recommendation: result.recommendation,
          journey: result.journey,
          explanation: result.explanation,
          meta: result.meta,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to plan mobility journey";
        setFetchError(message);
        setCanRetry(true);
        throw err;
      } finally {
        setIsSearching(false);
      }
    },
    [applyPlanResult]
  );

  const simulateEvent = useCallback(
    async (
      eventType: CityEventType,
      request: MobilityPlanRequest,
      currentRecommendation: MobilityRecommendation | null
    ) => {
      setIsSimulating(true);
      setRecommendationUpdated(false);

      const oldRoutes = routes;
      capturePrevSignals(oldRoutes);

      let newRoutes = oldRoutes;
      let newRecommendation: MobilityRecommendation | null = null;
      let explanation: RouteExplanation | null = null;

      try {
        const result = applyPlanResult(await planMobilityJourney(request));
        newRoutes = result.enrichedRoutes;
        newRecommendation = result.recommendation;
        explanation = result.explanation;
      } catch {
        newRoutes = oldRoutes;
      }

      const scoreChanges = detectScoreChanges(oldRoutes, newRoutes);
      const oldRecId = currentRecommendation?.recommendedRouteId;
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
        for (const route of newRoutes) synced[route.routeId] = { ...route.signals };
        setPrevSignals(synced);
      }, 2400);

      setIsSimulating(false);
      return {
        routes: newRoutes,
        recommendation: newRecommendation,
        explanation,
        recChanged,
      };
    },
    [routes, capturePrevSignals, detectScoreChanges, pushTimeline, applyPlanResult]
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
    prevSignals,
    timeline,
    recommendationUpdated,
    isSimulating,
    isSearching,
    fetchError,
    canRetry,
    runMobilityPlan,
    simulateEvent,
    clearRecommendationUpdated,
    clearError,
  };
}
