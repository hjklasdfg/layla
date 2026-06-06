import type { BusArrival, LegacyLineStatus, LiftOutage, TfLRouteSnapshot } from "./types";
import { isTfLConfigured, tflFetch } from "./client";
import { getMockTfLSnapshot } from "./mock-data";

interface TfLLineStatusResponse {
  id: string;
  name: string;
  lineStatuses: Array<{
    statusSeverity: number;
    reason?: string;
  }>;
}

interface TfLLiftDisruption {
  location?: string;
  comment?: string;
  isCurrentlyDisrupted?: boolean;
}

interface TfLStopPointArrival {
  lineName?: string;
  destinationName?: string;
  timeToStation: number;
}

interface TfLStopPointSearch {
  naptanId: string;
  commonName: string;
}

function mapLineSeverity(severity: number): LegacyLineStatus["severity"] {
  if (severity >= 10) return "good";
  if (severity >= 6) return "minor";
  return "severe";
}

function parseDelayMinutes(reason?: string): number | undefined {
  if (!reason) return undefined;
  const match = reason.match(/(\d+)\s*min/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Fetch live TfL snapshot; falls back to mock when key is missing. */
export async function fetchTfLRouteSnapshot(
  routeId: string,
  near?: { lat: number; lon: number }
): Promise<TfLRouteSnapshot> {
  if (!isTfLConfigured()) {
    return getMockTfLSnapshot(routeId);
  }

  try {
    const [lineData, liftData, busData] = await Promise.all([
      tflFetch<TfLLineStatusResponse[]>("/Line/Mode/tube,dlr,overground/Status"),
      tflFetch<TfLLiftDisruption[]>("/Network/LiftDisruptions"),
      near ? fetchNearbyBusArrivals(near.lat, near.lon) : Promise.resolve([]),
    ]);

    const lineStatuses: LegacyLineStatus[] = lineData.slice(0, 6).map((line) => {
      const status = line.lineStatuses[0];
      const severity = mapLineSeverity(status?.statusSeverity ?? 10);
      return {
        id: line.id,
        name: line.name,
        severity,
        delayMinutes: parseDelayMinutes(status?.reason),
      };
    });

    const liftOutages: LiftOutage[] = liftData
      .filter((d) => d.isCurrentlyDisrupted)
      .slice(0, 4)
      .map((d, i) => ({
        station: d.location ?? `Station ${i + 1}`,
        line: "—",
        active: true,
      }));

    if (liftOutages.length === 0) {
      liftOutages.push({
        station: "No active lift disruptions",
        line: "—",
        active: false,
      });
    }

    const busArrivals: BusArrival[] =
      busData.length > 0
        ? busData
        : [{ routeId: "—", stopName: "Nearest stop", minutesAway: 5 }];

    return { liftOutages, lineStatuses, busArrivals };
  } catch {
    return getMockTfLSnapshot(routeId);
  }
}

async function fetchNearbyBusArrivals(
  lat: number,
  lon: number
): Promise<BusArrival[]> {
  const stops = await tflFetch<TfLStopPointSearch[]>(
    `/StopPoint?lat=${lat}&lon=${lon}&stopTypes=NaptanPublicBusCoachTram&radius=400&modes=bus`
  );

  if (!stops.length) return [];

  const stop = stops[0];
  const arrivals = await tflFetch<TfLStopPointArrival[]>(
    `/StopPoint/${stop.naptanId}/Arrivals?mode=bus`
  );

  return arrivals.slice(0, 3).map((a) => ({
    routeId: a.lineName ?? "Bus",
    stopName: stop.commonName,
    minutesAway: Math.max(1, Math.round(a.timeToStation / 60)),
  }));
}
