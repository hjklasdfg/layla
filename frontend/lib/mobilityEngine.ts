import "server-only";

import type { JourneyStep, TfLJourneyLeg } from "@/services/tfl/types";
import { getJourneys } from "@/services/tfl/journey";
import { fetchTfLRouteSnapshot } from "@/services/tfl/fetch-snapshot";
import { normalizeTfLData } from "@/services/tfl/normalize";
import { fetchOSMFeatures } from "@/services/osm/overpass";
import { normalizeOSMFeatures } from "@/services/osm/osmNormalize";
import type { UserPreference } from "@/lib/agent/types";

export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RouteEndpoint {
  lat: number;
  lng: number;
}

export interface MobilityRouteState {
  id: string;
  etaMin: number;
  modes: string[];
  disruptions: string[];
  instructions: string[];
  steps: JourneyStep[];
  stopPointIds: string[];
  lineIds: string[];
  accessibilityScore: number;
  stepFree: boolean;
  osmEvidence: string[];
  tflEvidence: string[];
  mobilityNotes: string;
  geometry: RouteGeometry;
  start?: RouteEndpoint;
  end?: RouteEndpoint;
}

function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

function extractPathCoords(legs: TfLJourneyLeg[]): [number, number][] {
  const coords: [number, number][] = [];
  for (const leg of legs) {
    for (const pt of leg.path?.lineString ?? []) {
      if (Array.isArray(pt)) {
        coords.push([pt[0], pt[1]]);
      } else if (pt.lat !== undefined && pt.lon !== undefined) {
        coords.push([pt.lat, pt.lon]);
      }
    }
  }
  return coords;
}

function extractEndpoints(legs: TfLJourneyLeg[]): {
  start?: RouteEndpoint;
  end?: RouteEndpoint;
} {
  const dep = legs[0]?.departurePoint;
  const arr = legs[legs.length - 1]?.arrivalPoint;
  return {
    start:
      dep?.lat !== undefined && dep?.lon !== undefined
        ? { lat: dep.lat, lng: dep.lon }
        : undefined,
    end:
      arr?.lat !== undefined && arr?.lon !== undefined
        ? { lat: arr.lat, lng: arr.lon }
        : undefined,
  };
}

function routeBbox(
  legs: Array<{ path?: { lineString?: Array<{ lat?: number; lon?: number } | [number, number]> } }>
): { south: number; west: number; north: number; east: number } | null {
  const coords: Array<[number, number]> = [];

  for (const leg of legs) {
    for (const pt of leg.path?.lineString ?? []) {
      if (Array.isArray(pt)) {
        coords.push(pt as [number, number]);
      } else if (pt.lat !== undefined && pt.lon !== undefined) {
        coords.push([pt.lat, pt.lon]);
      }
    }
  }

  if (coords.length === 0) return null;

  const lats = coords.map(([lat]) => lat);
  const lons = coords.map(([, lon]) => lon);
  const pad = 0.003;

  return {
    south: Math.min(...lats) - pad,
    north: Math.max(...lats) + pad,
    west: Math.min(...lons) - pad,
    east: Math.max(...lons) + pad,
  };
}

function isStepFree(instructions: string[], disruptions: string[]): boolean {
  const text = [...instructions, ...disruptions].join(" ").toLowerCase();
  return !text.includes("step") && !text.includes("stairs") && !text.includes("stair");
}

export async function buildMobilityRoutes(
  from: string,
  to: string,
  _profile: UserPreference["profile"] = "general"
): Promise<{ routes: MobilityRouteState[]; osmWarning?: string }> {
  const candidates = await getJourneys(from, to);
  let osmWarning: string | undefined;

  const routes: MobilityRouteState[] = await Promise.all(
    candidates.map(async (candidate) => {
      const legs = candidate.rawJourney.legs ?? [];
      const bbox = routeBbox(legs);

      const departureCoord = (() => {
        const dep = legs[0]?.departurePoint;
        if (dep?.lat !== undefined && dep?.lon !== undefined) {
          return { lat: dep.lat, lon: dep.lon };
        }
        return undefined;
      })();

      const [tflSnapshot, osmData] = await Promise.all([
        fetchTfLRouteSnapshot(candidate.id, departureCoord).catch(() => null),
        bbox
          ? fetchOSMFeatures(bbox).catch(() => {
              osmWarning = "OSM accessibility data unavailable — route scored without it";
              return null;
            })
          : Promise.resolve(null),
      ]);

      const tflNorm = tflSnapshot
        ? normalizeTfLData(tflSnapshot)
        : { reliabilityImpact: 0, accessibilityImpact: 0, liftOutageRisk: 0, evidence: [] };

      const osmCtx = osmData ? normalizeOSMFeatures(osmData) : null;
      const stepCount = osmCtx?.stepsCount ?? 0;
      const osmEvidenceItems = osmCtx?.evidence ?? [];

      const baseScore = 100;
      const penaltyTfl = tflNorm.accessibilityImpact + tflNorm.liftOutageRisk * 0.5;
      const penaltyOsm = stepCount * 12;
      const stepPenalty = stepCount * 8;
      const accessibilityScore = clamp(baseScore - penaltyTfl - penaltyOsm - stepPenalty);

      const stepFreeRoute = isStepFree(candidate.instructions, candidate.disruptions) &&
        stepCount === 0 &&
        tflNorm.liftOutageRisk === 0;

      const pathCoords = extractPathCoords(legs);
      const { start, end } = extractEndpoints(legs);

      return {
        id: candidate.id,
        etaMin: candidate.etaMin,
        modes: candidate.modes,
        disruptions: candidate.disruptions,
        instructions: candidate.instructions,
        steps: candidate.steps,
        stopPointIds: candidate.stopPointIds,
        lineIds: candidate.lineIds,
        accessibilityScore,
        stepFree: stepFreeRoute,
        osmEvidence: osmEvidenceItems,
        tflEvidence: tflNorm.evidence ?? [],
        mobilityNotes: "",
        geometry: { type: "LineString", coordinates: pathCoords },
        start,
        end,
      };
    })
  );

  return { routes, osmWarning };
}
