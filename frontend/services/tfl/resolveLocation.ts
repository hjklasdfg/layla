import { searchStopPoints } from "./stopPoints";
import type { StopPointSummary, TfLDisambiguationOption } from "./types";
import { TflApiError } from "./types";

const NAPTAN_PATTERN = /^[0-9A-Z]{8,}$/;

export interface ResolvedLocationPoint {
  lat: number;
  lng: number;
  name: string;
}

export interface ResolvedJourneyEndpoint {
  query: string;
  segment: string;
  point: ResolvedLocationPoint | null;
}

export interface ResolvedJourneyEndpoints {
  from: ResolvedJourneyEndpoint;
  to: ResolvedJourneyEndpoint;
}

function encodeJourneyLocation(value: string): string {
  return encodeURIComponent(value.trim());
}

function scoreLocationName(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  const name = candidate.trim().toLowerCase();
  if (!q || !name) return 0;
  if (name === q) return 100;
  if (name.includes(q) || q.includes(name)) return 70;
  const words = q.split(/\s+/).filter((word) => word.length > 2);
  return words.filter((word) => name.includes(word)).length * 12;
}

export function pickBestStopMatch(
  query: string,
  stops: StopPointSummary[]
): StopPointSummary {
  if (stops.length <= 1) return stops[0]!;

  let best = stops[0]!;
  let bestScore = -1;
  for (const stop of stops) {
    const score = scoreLocationName(query, stop.name);
    if (score > bestScore) {
      bestScore = score;
      best = stop;
    }
  }
  return best;
}

export function pickBestDisambiguationOption(
  query: string,
  options: TfLDisambiguationOption[]
): TfLDisambiguationOption | null {
  if (!options.length) return null;
  if (options.length === 1) return options[0]!;

  let best = options[0]!;
  let bestScore = -1;
  for (const option of options) {
    const label = option.place?.name ?? option.parameterValue ?? "";
    const score = scoreLocationName(query, label);
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best;
}

function stopToJourneySegment(stop: StopPointSummary): string {
  if (stop.id.startsWith("HUB") || stop.id.startsWith("940")) {
    return encodeJourneyLocation(stop.id);
  }
  if (stop.lat !== undefined && stop.lon !== undefined) {
    return encodeJourneyLocation(`${stop.lat},${stop.lon}`);
  }
  return encodeJourneyLocation(stop.id);
}

async function resolveEndpoint(label: string): Promise<ResolvedJourneyEndpoint> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new TflApiError("Location cannot be empty", 400);
  }

  const latLon = trimmed.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (latLon) {
    const lat = Number.parseFloat(latLon[1]!);
    const lng = Number.parseFloat(latLon[2]!);
    return {
      query: trimmed,
      segment: encodeJourneyLocation(`${lat},${lng}`),
      point: { lat, lng, name: trimmed },
    };
  }

  if (NAPTAN_PATTERN.test(trimmed)) {
    return {
      query: trimmed,
      segment: encodeJourneyLocation(trimmed),
      point: null,
    };
  }

  const stops = await searchStopPoints(trimmed);
  if (stops.length > 0) {
    const stop = pickBestStopMatch(trimmed, stops);
    return {
      query: trimmed,
      segment: stopToJourneySegment(stop),
      point:
        stop.lat !== undefined && stop.lon !== undefined
          ? { lat: stop.lat, lng: stop.lon, name: stop.name }
          : null,
    };
  }

  return {
    query: trimmed,
    segment: encodeJourneyLocation(trimmed),
    point: null,
  };
}

/** Resolve both journey endpoints once — shared by TfL API + map markers. */
export async function resolveJourneyEndpoints(
  from: string,
  to: string
): Promise<ResolvedJourneyEndpoints> {
  const [fromEndpoint, toEndpoint] = await Promise.all([
    resolveEndpoint(from),
    resolveEndpoint(to),
  ]);
  return { from: fromEndpoint, to: toEndpoint };
}

/** Resolve a free-text label to map coordinates (best TfL stop match). */
export async function resolveLocationPoint(
  label: string
): Promise<ResolvedLocationPoint | null> {
  const endpoint = await resolveEndpoint(label);
  return endpoint.point;
}

/** Resolve a free-text label to a TfL journey endpoint segment (Naptan ID or lat,lon). */
export async function resolveJourneyLocation(label: string): Promise<string> {
  const endpoint = await resolveEndpoint(label);
  return endpoint.segment;
}
