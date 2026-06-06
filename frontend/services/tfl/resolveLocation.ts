import { searchStopPoints } from "./stopPoints";
import { TflApiError } from "./types";

const NAPTAN_PATTERN = /^[0-9A-Z]{8,}$/;

function encodeJourneyLocation(value: string): string {
  return encodeURIComponent(value.trim());
}

/** Resolve a free-text label to a TfL journey endpoint segment (Naptan ID or lat,lon). */
export async function resolveJourneyLocation(label: string): Promise<string> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new TflApiError("Location cannot be empty", 400);
  }

  if (NAPTAN_PATTERN.test(trimmed)) {
    return encodeJourneyLocation(trimmed);
  }

  const stops = await searchStopPoints(trimmed);
  if (stops.length > 0) {
    const stop = stops[0];
    if (stop.id.startsWith("HUB") || stop.id.startsWith("940")) {
      return encodeJourneyLocation(stop.id);
    }
    if (stop.lat !== undefined && stop.lon !== undefined) {
      return encodeJourneyLocation(`${stop.lat},${stop.lon}`);
    }
    return encodeJourneyLocation(stop.id);
  }

  return encodeJourneyLocation(trimmed);
}
