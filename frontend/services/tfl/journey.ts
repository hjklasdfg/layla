import { serverEnv, tflQueryParams } from "@/lib/config/env";
import { parseJourneySteps } from "./journeySteps";
import {
  pickBestDisambiguationOption,
  resolveJourneyLocation,
} from "./resolveLocation";
import type {
  RouteCandidate,
  TfLDisambiguation,
  TfLDisambiguationOption,
  TfLJourneyLeg,
  TfLJourneyResultsResponse,
  TfLRawJourney,
} from "./types";
import { TflApiError } from "./types";

const TFL_BASE = "https://api.tfl.gov.uk";
const DEFAULT_TIMEOUT_MS = 20_000;

const TRANSIT_MODES = new Set([
  "tube",
  "bus",
  "overground",
  "dlr",
  "elizabeth-line",
  "national-rail",
  "tram",
  "river-bus",
  "coach",
  "replacement-bus",
]);

const JOURNEY_MODES =
  "mode=tube,bus,walking,overground,dlr,elizabeth-line&alternativeJourney=3";

function countTransfers(legs: TfLJourneyLeg[]): number {
  const transitLegs = legs.filter((l) => TRANSIT_MODES.has(l.mode?.id ?? ""));
  return Math.max(0, transitLegs.length - 1);
}

function sumWalkingMinutes(legs: TfLJourneyLeg[]): number {
  return legs
    .filter((l) => l.mode?.id === "walking")
    .reduce((sum, l) => sum + (l.duration ?? 0), 0);
}

function collectModes(legs: TfLJourneyLeg[]): string[] {
  const modes = new Set<string>();
  for (const leg of legs) {
    const id = leg.mode?.id;
    if (id && id !== "walking") modes.add(leg.mode?.name ?? id);
  }
  if (legs.some((l) => l.mode?.id === "walking")) modes.add("Walking");
  return [...modes];
}

function collectDisruptions(journey: TfLRawJourney): string[] {
  const messages = new Set<string>();
  for (const leg of journey.legs ?? []) {
    for (const d of leg.disruptions ?? []) {
      const text = d.description ?? d.summary ?? d.categoryDescription;
      if (text) messages.add(text);
    }
  }
  return [...messages];
}

function collectInstructions(legs: TfLJourneyLeg[]): string[] {
  return legs
    .map((l) => l.instruction?.summary ?? l.instruction?.detailed ?? "")
    .filter(Boolean);
}

function collectStopPointIds(legs: TfLJourneyLeg[]): string[] {
  const ids = new Set<string>();
  for (const leg of legs) {
    if (TRANSIT_MODES.has(leg.mode?.id ?? "")) {
      const id = leg.departurePoint?.naptanId;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function collectLineIds(legs: TfLJourneyLeg[]): string[] {
  const ids = new Set<string>();
  for (const leg of legs) {
    for (const opt of leg.routeOptions ?? []) {
      const id = opt.lineIdentifier?.id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function normalizeJourney(journey: TfLRawJourney, index: number): RouteCandidate {
  const legs = journey.legs ?? [];
  return {
    id: String.fromCharCode(65 + index),
    etaMin: Math.max(1, Math.round(journey.duration ?? 0)),
    transferCount: countTransfers(legs),
    walkingMinutes: sumWalkingMinutes(legs),
    modes: collectModes(legs),
    disruptions: collectDisruptions(journey),
    instructions: collectInstructions(legs),
    steps: parseJourneySteps(legs),
    stopPointIds: collectStopPointIds(legs),
    lineIds: collectLineIds(legs),
    rawJourney: journey,
  };
}

function pickDisambiguationOption(
  disambiguation: TfLDisambiguation | undefined,
  userQuery: string
): string | null {
  const options = disambiguation?.disambiguationOptions ?? [];
  const option = pickBestDisambiguationOption(userQuery, options);
  if (!option) return null;
  return optionToJourneySegment(option);
}

function optionToJourneySegment(option: TfLDisambiguationOption): string | null {
  if (option.parameterValue) {
    return encodeURIComponent(option.parameterValue);
  }
  const place = option.place;
  if (place?.naptanId) {
    return encodeURIComponent(place.naptanId);
  }
  if (place?.lat && place?.lon) {
    return encodeURIComponent(`${place.lat},${place.lon}`);
  }
  return null;
}

async function fetchJourneyResults(
  fromSegment: string,
  toSegment: string
): Promise<TfLJourneyResultsResponse> {
  if (!serverEnv.tfl.enabled) {
    throw new TflApiError(
      "TfL API key not configured. Set TFL_APP_KEY in .env.local"
    );
  }

  const sep = "?";
  const qs = tflQueryParams().replace("?", "");
  const url = `${TFL_BASE}/Journey/JourneyResults/${fromSegment}/to/${toSegment}${sep}${qs}&${JOURNEY_MODES}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: 0 },
    });

    const data = (await res.json()) as TfLJourneyResultsResponse;

    if (res.status === 300) {
      return data;
    }

    if (!res.ok) {
      throw new TflApiError(
        `TfL API error ${res.status} for /Journey/JourneyResults`,
        res.status
      );
    }

    return data;
  } catch (err) {
    if (err instanceof TflApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TflApiError("TfL API request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch live journey options between two locations. */
export async function getJourneys(
  from: string,
  to: string,
  options?: {
    fromSegment?: string;
    toSegment?: string;
  }
): Promise<RouteCandidate[]> {
  const fromSegment = options?.fromSegment ?? (await resolveJourneyLocation(from));
  const toSegment = options?.toSegment ?? (await resolveJourneyLocation(to));

  let data = await fetchJourneyResults(fromSegment, toSegment);

  const fromAlt = pickDisambiguationOption(data.fromLocationDisambiguation, from);
  const toAlt = pickDisambiguationOption(data.toLocationDisambiguation, to);

  if (fromAlt || toAlt) {
    data = await fetchJourneyResults(
      fromAlt ?? fromSegment,
      toAlt ?? toSegment
    );
  }

  if (
    data.fromLocationDisambiguation?.disambiguationOptions?.length ||
    data.toLocationDisambiguation?.disambiguationOptions?.length
  ) {
    throw new TflApiError(
      "Location is ambiguous — try a more specific address or station name",
      422
    );
  }

  const journeys = data.journeys ?? [];
  if (journeys.length === 0) {
    throw new TflApiError(
      "No journeys found for these locations. Check spelling or try station names.",
      404
    );
  }

  return journeys.slice(0, 4).map(normalizeJourney);
}
