import "server-only";

import type { AccessibilitySignals, RouteEvidence } from "@/lib/accessibility/types";
import type { UserPreference } from "@/lib/agent/types";
import { fetchOSMFeatures } from "@/services/osm/overpass";
import { normalizeOSMFeatures } from "@/services/osm/osmNormalize";
import type { OSMEnrichedContext, OSMRiskyFeature, RouteBoundingBox } from "@/services/osm/types";
import { fetchTfLRouteSnapshot } from "@/services/tfl/fetch-snapshot";
import { getJourneys } from "@/services/tfl/journey";
import { summarizeJourneySteps } from "@/services/tfl/journeySteps";
import { normalizeTfLData } from "@/services/tfl/normalize";
import type { JourneyStep, RouteCandidate, TfLJourneyLeg, TfLRawJourney } from "@/services/tfl/types";
import type { JourneyAnchorPoints } from "@/lib/mobility/backend-plan-types";
import type { ResolvedLocationPoint } from "@/services/tfl/resolveLocation";
import { haversineKm } from "@/lib/geo/haversine";

export type { JourneyAnchorPoints };

export interface MobilityRouteState {
  id: string;
  name: string;
  etaMin: number;
  geometry: { coordinates: [number, number][] };
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  signals: AccessibilitySignals;
  evidence: RouteEvidence;
  risks: string[];
  strengths: string[];
  steps: JourneyStep[];
  transferCount: number;
  walkingMinutes: number;
  disruptions: string[];
  modes: string[];
  riskyFeatures: OSMRiskyFeature[];
  osmContext: OSMEnrichedContext | null;
  additionalWaitMin?: number;
  plannedEtaMin?: number;
}

function anchorGeometryToJourney(
  coords: [number, number][],
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): [number, number][] {
  if (coords.length < 2) {
    return [
      [start.lat, start.lng],
      [end.lat, end.lng],
    ];
  }

  const anchored = coords.map((coord) => [...coord] as [number, number]);
  anchored[0] = [start.lat, start.lng];
  anchored[anchored.length - 1] = [end.lat, end.lng];
  return anchored;
}

function routeMatchesJourneyAnchors(
  route: MobilityRouteState,
  anchors: JourneyAnchorPoints
): boolean {
  const { start, end, maxEndpointDriftKm = 12 } = anchors;
  if (!start || !end) return true;

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return false;

  const geomStart = coords[0]!;
  const geomEnd = coords[coords.length - 1]!;

  const startDrift = haversineKm(geomStart[0], geomStart[1], start.lat, start.lng);
  const endDrift = haversineKm(geomEnd[0], geomEnd[1], end.lat, end.lng);

  return startDrift <= maxEndpointDriftKm && endDrift <= maxEndpointDriftKm;
}

function buildFallbackRoute(
  candidate: RouteCandidate,
  start: ResolvedLocationPoint,
  end: ResolvedLocationPoint
): MobilityRouteState {
  const geometryCoords: [number, number][] = [
    [start.lat, start.lng],
    [end.lat, end.lng],
  ];
  const signals: AccessibilitySignals = {
    accessibility: 70,
    stress: 40,
    reliability: 75,
    predictability: 72,
    crowding: 35,
    crossingComplexity: 30,
  };

  return {
    id: candidate.id,
    name: summarizeJourneySteps(candidate.steps) || `Route ${candidate.id}`,
    etaMin: candidate.etaMin,
    geometry: { coordinates: geometryCoords },
    start: { lat: start.lat, lng: start.lng },
    end: { lat: end.lat, lng: end.lng },
    signals,
    evidence: {
      tfl: candidate.instructions.slice(0, 4),
      osm: ["Map path approximated — TfL geometry did not match journey endpoints"],
      cv: [],
    },
    risks: candidate.disruptions.length ? candidate.disruptions.slice(0, 2) : ["Approximate map path"],
    strengths: ["Journey timing from TfL"],
    steps: candidate.steps,
    transferCount: candidate.transferCount,
    walkingMinutes: candidate.walkingMinutes,
    disruptions: candidate.disruptions,
    modes: candidate.modes,
    riskyFeatures: [],
    osmContext: null,
  };
}

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function extractPoint(
  point: { lat?: number; lon?: number } | [number, number]
): [number, number] | null {
  if (Array.isArray(point)) {
    const [a, b] = point;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(a) <= 90 ? [a, b] : [b, a];
  }
  if (point.lat === undefined || point.lon === undefined) return null;
  return [point.lat, point.lon];
}

function extractJourneyGeometry(journey: TfLRawJourney): [number, number][] {
  const coords: [number, number][] = [];

  for (const leg of journey.legs ?? []) {
    for (const point of leg.path?.lineString ?? []) {
      const parsed = extractPoint(point);
      if (!parsed) continue;
      const prev = coords[coords.length - 1];
      if (prev && prev[0] === parsed[0] && prev[1] === parsed[1]) continue;
      coords.push(parsed);
    }
  }

  return coords;
}

function endpointFromLegs(legs: TfLJourneyLeg[]): {
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
} {
  const first = legs[0]?.departurePoint;
  const last = legs[legs.length - 1]?.arrivalPoint;

  const start =
    first?.lat !== undefined && first.lon !== undefined
      ? { lat: first.lat, lng: first.lon }
      : null;
  const end =
    last?.lat !== undefined && last.lon !== undefined
      ? { lat: last.lat, lng: last.lon }
      : null;

  return { start, end };
}

function geometryBoundingBox(coordinates: [number, number][]): RouteBoundingBox | null {
  if (coordinates.length === 0) return null;

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const [lat, lng] of coordinates) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }

  const pad = 0.004;
  return {
    south: south - pad,
    west: west - pad,
    north: north + pad,
    east: east + pad,
  };
}

function composeSignals(
  candidate: RouteCandidate,
  tflImpact: ReturnType<typeof normalizeTfLData>,
  osm: OSMEnrichedContext | null,
  profile: UserPreference["profile"]
): AccessibilitySignals {
  const stepsPenalty = (osm?.stepsCount ?? 0) * 8 + (candidate.walkingMinutes > 12 ? 6 : 0);
  const crossingPenalty = osm ? Math.min(45, osm.crossingCount * 6) : 15;
  const tactileBonus = osm && osm.tactilePavingCount > 0 ? 8 : 0;
  const wheelchairBonus = osm ? Math.min(12, osm.wheelchairTaggedCount * 3) : 0;

  let accessibility = clamp(
    92 -
      tflImpact.accessibilityImpact -
      tflImpact.liftOutageRisk * 0.4 -
      stepsPenalty +
      tactileBonus +
      wheelchairBonus
  );
  let stress = clamp(
    28 +
      tflImpact.transportDelayRisk * 0.45 +
      crossingPenalty +
      (candidate.transferCount > 2 ? 10 : candidate.transferCount * 4) +
      (osm?.stepsCount ?? 0) * 5
  );
  let reliability = clamp(90 - tflImpact.reliabilityImpact);
  let predictability = clamp(
    88 - tflImpact.predictabilityImpact - (candidate.transferCount > 1 ? 8 : 0)
  );
  let crowding = clamp(30 + candidate.transferCount * 8 + tflImpact.transportDelayRisk * 0.2);
  let crossingComplexity = clamp(
    crossingPenalty + (osm?.trafficSignalCount ?? 0) * 4 + (osm?.kerbCount ?? 0) * 2
  );

  switch (profile) {
    case "wheelchair":
      accessibility = clamp(accessibility + 5 - stepsPenalty * 0.5);
      stress = clamp(stress + stepsPenalty * 0.3);
      break;
    case "blind":
      predictability = clamp(predictability + tactileBonus);
      crossingComplexity = clamp(crossingComplexity + 8);
      break;
    case "elderly":
      accessibility = clamp(accessibility + 4);
      stress = clamp(stress + candidate.walkingMinutes * 0.8);
      break;
    case "custom":
    case "general":
    default:
      break;
  }

  return {
    accessibility,
    stress,
    reliability,
    predictability,
    crowding,
    crossingComplexity,
  };
}

function buildRisksAndStrengths(
  candidate: RouteCandidate,
  signals: AccessibilitySignals,
  osm: OSMEnrichedContext | null
): { risks: string[]; strengths: string[] } {
  const risks: string[] = [];
  const strengths: string[] = [];

  if (candidate.disruptions.length > 0) {
    risks.push(...candidate.disruptions.slice(0, 2));
  }
  if ((osm?.stepsCount ?? 0) > 0) {
    risks.push(`${osm!.stepsCount} step segment(s) near route`);
  }
  if (signals.stress >= 60) {
    risks.push("Elevated journey stress");
  }
  if (signals.reliability < 55) {
    risks.push("Reliability below comfort threshold");
  }
  if (candidate.transferCount >= 2) {
    risks.push(`${candidate.transferCount} transfers required`);
  }
  if (signals.crossingComplexity >= 55) {
    risks.push("Complex crossing sequence");
  }

  if (signals.accessibility >= 75) {
    strengths.push("Strong accessibility score");
  }
  if (candidate.walkingMinutes <= 8) {
    strengths.push("Minimal walking distance");
  }
  if ((osm?.wheelchairTaggedCount ?? 0) > 0) {
    strengths.push("Wheelchair-accessible infrastructure mapped");
  }
  if ((osm?.tactilePavingCount ?? 0) > 0) {
    strengths.push("Tactile paving detected nearby");
  }
  if (candidate.disruptions.length === 0) {
    strengths.push("No active TfL disruptions on this journey");
  }
  if (signals.reliability >= 75) {
    strengths.push("Reliable service indicators");
  }

  if (risks.length === 0) {
    risks.push("No major risks flagged");
  }
  if (strengths.length === 0) {
    strengths.push("Balanced overall mobility profile");
  }

  return { risks, strengths };
}

async function enrichCandidate(
  candidate: RouteCandidate,
  profile: UserPreference["profile"],
  osmWarningRef: { value?: string },
  anchors?: JourneyAnchorPoints
): Promise<MobilityRouteState | null> {
  const { start, end } = endpointFromLegs(candidate.rawJourney.legs ?? []);
  let geometryCoords = extractJourneyGeometry(candidate.rawJourney);

  if (geometryCoords.length < 2 && start && end) {
    geometryCoords = [
      [start.lat, start.lng],
      [end.lat, end.lng],
    ];
  }

  if (!start || !end || geometryCoords.length < 2) {
    return null;
  }

  const rawRoute: MobilityRouteState = {
    id: candidate.id,
    name: summarizeJourneySteps(candidate.steps) || `Route ${candidate.id}`,
    etaMin: candidate.etaMin,
    geometry: { coordinates: geometryCoords },
    start,
    end,
    signals: {
      accessibility: 0,
      stress: 0,
      reliability: 0,
      predictability: 0,
      crowding: 0,
      crossingComplexity: 0,
    },
    evidence: { tfl: [], osm: [], cv: [] },
    risks: [],
    strengths: [],
    steps: candidate.steps,
    transferCount: candidate.transferCount,
    walkingMinutes: candidate.walkingMinutes,
    disruptions: candidate.disruptions,
    modes: candidate.modes,
    riskyFeatures: [],
    osmContext: null,
  };

  if (anchors?.start && anchors?.end && !routeMatchesJourneyAnchors(rawRoute, anchors)) {
    return null;
  }

  let routeStart = start;
  let routeEnd = end;
  if (anchors?.start && anchors?.end) {
    geometryCoords = anchorGeometryToJourney(geometryCoords, anchors.start, anchors.end);
    routeStart = { lat: anchors.start.lat, lng: anchors.start.lng };
    routeEnd = { lat: anchors.end.lat, lng: anchors.end.lng };
  }

  let osmContext: OSMEnrichedContext | null = null;
  const bbox = geometryBoundingBox(geometryCoords);

  if (bbox) {
    try {
      const osmResponse = await fetchOSMFeatures(bbox);
      osmContext = normalizeOSMFeatures(osmResponse, geometryCoords);
    } catch (err) {
      if (!osmWarningRef.value) {
        osmWarningRef.value =
          err instanceof Error
            ? `OSM enrichment unavailable: ${err.message}`
            : "OSM enrichment unavailable";
      }
    }
  }

  const midpoint = geometryCoords[Math.floor(geometryCoords.length / 2)];
  const tflSnapshot = await fetchTfLRouteSnapshot(candidate.id, {
    lat: midpoint[0],
    lon: midpoint[1],
  });
  const tflImpact = normalizeTfLData(tflSnapshot);
  const signals = composeSignals(candidate, tflImpact, osmContext, profile);

  const evidence: RouteEvidence = {
    tfl: tflImpact.evidence.slice(0, 6),
    osm: osmContext?.evidence.slice(0, 6) ?? ["OSM data unavailable for corridor"],
    cv: [],
  };

  const { risks, strengths } = buildRisksAndStrengths(candidate, signals, osmContext);

  return {
    id: candidate.id,
    name: summarizeJourneySteps(candidate.steps) || `Route ${candidate.id}`,
    etaMin: candidate.etaMin,
    geometry: { coordinates: geometryCoords },
    start: routeStart,
    end: routeEnd,
    signals,
    evidence,
    risks,
    strengths,
    steps: candidate.steps,
    transferCount: candidate.transferCount,
    walkingMinutes: candidate.walkingMinutes,
    disruptions: candidate.disruptions,
    modes: candidate.modes,
    riskyFeatures: osmContext?.riskyFeatures ?? [],
    osmContext,
  };
}

/** Enrich pre-fetched TfL candidates with OSM accessibility context. */
export async function buildMobilityRoutesFromCandidates(
  candidates: RouteCandidate[],
  profile: UserPreference["profile"] = "general",
  anchors?: JourneyAnchorPoints
): Promise<{ routes: MobilityRouteState[]; osmWarning?: string }> {
  const osmWarningRef: { value?: string } = {};
  const routes: MobilityRouteState[] = [];

  for (const candidate of candidates) {
    const enriched = await enrichCandidate(candidate, profile, osmWarningRef, anchors);
    if (enriched) routes.push(enriched);
  }

  if (!routes.length && anchors?.start && anchors?.end && candidates.length > 0) {
    osmWarningRef.value =
      osmWarningRef.value ??
      "TfL map paths did not match your journey locations — showing direct paths between start and end.";
    for (const candidate of candidates.slice(0, 3)) {
      routes.push(buildFallbackRoute(candidate, anchors.start, anchors.end));
    }
  }

  return { routes, osmWarning: osmWarningRef.value };
}

/** Fetch TfL journeys and enrich with OSM accessibility context. */
export async function buildMobilityRoutes(
  from: string,
  to: string,
  profile: UserPreference["profile"] = "general"
): Promise<{ routes: MobilityRouteState[]; osmWarning?: string }> {
  const candidates = await getJourneys(from, to);
  return buildMobilityRoutesFromCandidates(candidates, profile);
}
