import { tflFetch } from "./client";
import type {
  StopPointSummary,
  TfLStopPointDetail,
  TfLStopPointSearchResponse,
} from "./types";

function mapMatchToSummary(
  match: NonNullable<TfLStopPointSearchResponse["matches"]>[number],
  fallbackName: string
): StopPointSummary | null {
  const id = match.naptanId ?? match.id;
  if (!id) return null;
  return {
    id,
    name: match.commonName ?? match.name ?? fallbackName,
    lat: match.lat,
    lon: match.lon,
  };
}

/** Search stop points by name — useful for resolving ambiguous locations. */
export async function searchStopPoints(
  query: string
): Promise<StopPointSummary[]> {
  const encoded = encodeURIComponent(query.trim());
  const data = await tflFetch<TfLStopPointSearchResponse>(
    `/StopPoint/Search/${encoded}`
  );

  const matches = data.matches ?? [];
  return matches
    .map((m) => mapMatchToSummary(m, query))
    .filter((s): s is StopPointSummary => s !== null)
    .slice(0, 5);
}

/** Fetch a single stop point by Naptan ID. */
export async function getStopPoint(
  stopPointId: string
): Promise<StopPointSummary | null> {
  try {
    const data = await tflFetch<TfLStopPointDetail>(
      `/StopPoint/${encodeURIComponent(stopPointId)}`
    );
    const id = data.naptanId ?? data.id;
    if (!id) return null;
    return {
      id,
      name: data.commonName ?? data.name ?? stopPointId,
      lat: data.lat,
      lon: data.lon,
    };
  } catch {
    return null;
  }
}
