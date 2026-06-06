import { tflFetch } from "./client";
import type { ArrivalInfo, TfLArrivalResponse } from "./types";

/** Fetch live arrivals for a stop point, sorted nearest first. */
export async function getArrivals(stopPointId: string): Promise<ArrivalInfo[]> {
  const data = await tflFetch<TfLArrivalResponse[]>(
    `/StopPoint/${encodeURIComponent(stopPointId)}/Arrivals`
  );

  return data
    .map((a) => ({
      destination: a.destinationName ?? "Unknown",
      arrivalMinutes: Math.max(
        0,
        Math.round((a.timeToStation ?? 0) / 60)
      ),
      lineName: a.lineName,
      modeName: a.modeName,
    }))
    .sort((a, b) => a.arrivalMinutes - b.arrivalMinutes)
    .slice(0, 5);
}
