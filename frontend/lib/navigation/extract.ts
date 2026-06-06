/** Convert a Valhalla trace_route / route response into our internal NavRoute. */

import polyline from "@mapbox/polyline";
import type { NavManeuver, NavRoute } from "./types";

const VALHALLA_TYPE_MAP: Record<number, string> = {
  1: "depart",
  2: "depart-right",
  3: "depart-left",
  4: "destination",
  5: "destination-right",
  6: "destination-left",
  7: "becomes",
  8: "continue",
  9: "slight-right",
  10: "right",
  11: "sharp-right",
  12: "uturn-right",
  13: "uturn-left",
  14: "sharp-left",
  15: "left",
  16: "slight-left",
  17: "ramp-straight",
  18: "ramp-right",
  19: "ramp-left",
  20: "exit-right",
  21: "exit-left",
  22: "stay-straight",
  23: "stay-right",
  24: "stay-left",
  25: "merge",
  26: "roundabout-enter",
  27: "roundabout-exit",
};

interface ValhallaManeuver {
  type: number;
  instruction?: string;
  street_names?: string[];
  verbal_pre_transition_instruction?: string;
  verbal_transition_alert_instruction?: string;
  verbal_post_transition_instruction?: string;
  begin_shape_index?: number;
  length?: number; // km
  time?: number; // seconds
}

interface ValhallaLeg {
  maneuvers: ValhallaManeuver[];
  shape: string; // encoded polyline, precision 6
  summary?: { length?: number; time?: number };
}

interface ValhallaResponse {
  trip: {
    legs: ValhallaLeg[];
    summary?: { length?: number; time?: number };
  };
}

function mapType(rawType: number): string {
  return VALHALLA_TYPE_MAP[rawType] ?? `unknown-${rawType}`;
}

export function extractNavRoute(valhalla: ValhallaResponse): NavRoute {
  const leg = valhalla.trip.legs[0];
  // Valhalla uses precision 6 for shape encoding
  const decoded = polyline.decode(leg.shape, 6); // returns [[lat, lng], ...]
  const geometry: [number, number][] = decoded.map(
    ([lat, lng]) => [lng, lat] as [number, number]
  );

  const maneuvers: NavManeuver[] = leg.maneuvers.map((m) => ({
    type: mapType(m.type),
    rawType: m.type,
    instruction: m.instruction ?? "",
    streetNames: m.street_names ?? [],
    beginShapeIndex: m.begin_shape_index ?? 0,
    lengthM: (m.length ?? 0) * 1000,
    durationSec: m.time ?? 0,
    voice: {
      pre: m.verbal_pre_transition_instruction,
      alert: m.verbal_transition_alert_instruction,
      post: m.verbal_post_transition_instruction,
    },
  }));

  const totalDistanceM = (valhalla.trip.summary?.length ?? 0) * 1000;
  const totalDurationSec = valhalla.trip.summary?.time ?? 0;

  return {
    geometry,
    maneuvers,
    totalDistanceM: totalDistanceM || maneuvers.reduce((s, m) => s + m.lengthM, 0),
    totalDurationSec: totalDurationSec || maneuvers.reduce((s, m) => s + m.durationSec, 0),
  };
}
