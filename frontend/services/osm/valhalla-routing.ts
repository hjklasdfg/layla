import polyline from "@mapbox/polyline";
import type { LegacyOSMRouteContext } from "./types";
import type { FootRoute, RouteGeometry } from "./routing";

interface ValhallaManeuver {
  type: number;
  instruction?: string;
}

interface ValhallaTrip {
  summary: { time: number; length: number };
  legs: Array<{ maneuvers: ValhallaManeuver[]; shape?: string }>;
}

interface ValhallaResponse {
  trip: ValhallaTrip;
  alternates?: Array<{ trip: ValhallaTrip }>;
}

/** Turn / crossing maneuver types in Valhalla (subset). */
const TURN_TYPES = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);

function decodeShape(shape: string): [number, number][] {
  return polyline.decode(shape, 6).map(([lat, lon]) => [lon, lat] as [number, number]);
}

/** Derive accessibility context from Valhalla turn-by-turn data (no Overpass needed). */
export function deriveContextFromValhalla(trip: ValhallaTrip): LegacyOSMRouteContext {
  const maneuvers = trip.legs.flatMap((l) => l.maneuvers ?? []);
  const text = maneuvers.map((m) => (m.instruction ?? "").toLowerCase());

  const turnCount = maneuvers.filter((m) => TURN_TYPES.has(m.type)).length;
  const crossingMentions = text.filter((t) => t.includes("cross")).length;
  const steps = text.filter((t) => t.includes("stair") || t.includes("step")).length;
  const crossings = Math.max(crossingMentions, Math.min(Math.ceil(turnCount / 2), 8));

  let tactilePaving: LegacyOSMRouteContext["tactilePaving"] = "partial";
  if (crossings === 0) tactilePaving = "continuous";
  if (crossings >= 3) tactilePaving = "none";

  let wheelchairAccessible: LegacyOSMRouteContext["wheelchairAccessible"] = "full";
  if (steps > 0) wheelchairAccessible = "partial";
  if (text.some((t) => t.includes("ferry") || t.includes("unpaved"))) {
    wheelchairAccessible = "partial";
  }

  return {
    crossings,
    footways: Math.max(1, Math.min(maneuvers.length, 12)),
    steps,
    tactilePaving,
    wheelchairAccessible,
  };
}

function tripToFootRoute(trip: ValhallaTrip): FootRoute {
  const shape = trip.legs.map((l) => l.shape ?? "").join("");
  const coordinates = shape ? decodeShape(shape) : [];
  return {
    durationSec: trip.summary.time,
    distanceM: trip.summary.length * 1000,
    geometry: { coordinates, distanceM: trip.summary.length * 1000 },
  };
}

/** Walking routes via Valhalla (OpenStreetMap.de public instance). */
export async function searchValhallaFootRoutes(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  valhallaUrl: string
): Promise<Array<FootRoute & { osm: LegacyOSMRouteContext }>> {
  const base = valhallaUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [
        { lat: from.lat, lon: from.lon },
        { lat: to.lat, lon: to.lon },
      ],
      costing: "pedestrian",
      alternates: 2,
      directions_options: { units: "kilometers" },
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Valhalla routing failed (${res.status})`);
  }

  const data = (await res.json()) as ValhallaResponse;
  const trips: ValhallaTrip[] = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];

  const seen = new Set<string>();
  const routes: Array<FootRoute & { osm: LegacyOSMRouteContext }> = [];

  for (const trip of trips) {
    const route = tripToFootRoute(trip);
    const key = `${Math.round(route.durationSec)}-${Math.round(route.distanceM)}`;
    if (seen.has(key) || route.geometry.coordinates.length < 2) continue;
    seen.add(key);
    routes.push({ ...route, osm: deriveContextFromValhalla(trip) });
  }

  routes.sort((a, b) => a.durationSec - b.durationSec);
  return routes.slice(0, 2);
}

export type { RouteGeometry };
