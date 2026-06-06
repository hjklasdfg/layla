/** Self-contained voice navigation module types — no project coupling. */

export interface NavManeuver {
  /** Semantic action name (mapped from Valhalla numeric type) */
  type: string;
  /** Original Valhalla numeric type, kept for debugging */
  rawType: number;
  /** Screen-display text (fallback if no verbal cue) */
  instruction: string;
  /** Street name(s) for this segment */
  streetNames: string[];
  /** Index in NavRoute.geometry where this maneuver starts */
  beginShapeIndex: number;
  /** Length of this segment in meters */
  lengthM: number;
  /** Duration of this segment in seconds */
  durationSec: number;
  /** Text to speak at different distances */
  voice: {
    /** Far cue: "In 200 metres, turn left onto Cannon Street." */
    pre?: string;
    /** Near cue: "Turn left onto Cannon Street." */
    alert?: string;
    /** After-turn cue: "Continue for 150 metres." */
    post?: string;
  };
}

export interface NavRoute {
  /** Polyline as [longitude, latitude] pairs */
  geometry: Array<[number, number]>;
  maneuvers: NavManeuver[];
  totalDistanceM: number;
  totalDurationSec: number;
}

export interface GpsTick {
  lat: number;
  lng: number;
  /** GPS accuracy in meters (informational) */
  accuracyM?: number;
  timestamp?: number;
}

export interface NavigationState {
  route: NavRoute;
  /** Index of the maneuver we are CURRENTLY in (have departed from) */
  currentManeuverIndex: number;
  /** Keys of cues we've already spoken — prevents repeats */
  spokenKeys: Set<string>;
  /** Last GPS we processed (for off-route detection) */
  lastGps: GpsTick | null;
  startedAt: number;
  isArrived: boolean;
}

export type NavigationEvent =
  | { kind: "speak"; text: string; priority: "low" | "normal" | "high" }
  | { kind: "advance"; toIndex: number }
  | { kind: "progress"; distanceToNextManeuverM: number; currentManeuverIndex: number }
  | { kind: "arrived" };
