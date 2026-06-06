export type CityEventType =
  | "lift_outage"
  | "line_delay"
  | "signal_failure"
  | "heavy_rain"
  | "crowd_surge"
  | "road_closure";

export interface CityEventDefinition {
  type: CityEventType;
  label: string;
}

export const CITY_EVENTS: CityEventDefinition[] = [
  { type: "lift_outage", label: "Lift outage" },
  { type: "line_delay", label: "Line delay" },
  { type: "signal_failure", label: "Signal failure" },
  { type: "heavy_rain", label: "Heavy rain" },
  { type: "crowd_surge", label: "Crowd surge" },
  { type: "road_closure", label: "Road closure" },
];

export type TimelineSeverity = "info" | "warning" | "critical";

export interface TimelineEntry {
  id: string;
  time: string;
  message: string;
  severity: TimelineSeverity;
}

export function createTimelineEntry(
  message: string,
  severity: TimelineSeverity
): TimelineEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    message,
    severity,
  };
}
