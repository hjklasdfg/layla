export type CityEventType =
  | "lift_outage"
  | "severe_delay"
  | "minor_delay"
  | "station_closure"
  | "weather_alert";

export interface CityEvent {
  type: CityEventType;
  label: string;
}

export const CITY_EVENTS: CityEvent[] = [
  { type: "lift_outage", label: "Lift Outage" },
  { type: "severe_delay", label: "Severe Delay" },
  { type: "minor_delay", label: "Minor Delay" },
  { type: "station_closure", label: "Station Closure" },
  { type: "weather_alert", label: "Weather Alert" },
];

export interface TimelineEntry {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  timestamp: number;
  time?: string;
}

export function createTimelineEntry(
  message: string,
  severity: TimelineEntry["severity"]
): TimelineEntry {
  const now = Date.now();
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    severity,
    timestamp: now,
    time: new Date(now).toLocaleTimeString(),
  };
}
