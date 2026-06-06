import "server-only";

import { serverEnv } from "@/lib/config/env";
import type { OverpassResponse, RouteBoundingBox } from "./types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_TIMEOUT_MS = 25_000;

const cache = new Map<string, { data: OverpassResponse; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function bboxCacheKey(bbox: RouteBoundingBox): string {
  const round = (n: number) => n.toFixed(4);
  return `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
}

function buildOverpassQuery(bbox: RouteBoundingBox): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:25];
(
  node["highway"="crossing"](${south},${west},${north},${east});
  node["crossing"](${south},${west},${north},${east});
  node["traffic_signals"](${south},${west},${north},${east});

  way["highway"="footway"](${south},${west},${north},${east});
  way["footway"](${south},${west},${north},${east});
  way["sidewalk"](${south},${west},${north},${east});

  way["highway"="steps"](${south},${west},${north},${east});
  node["highway"="steps"](${south},${west},${north},${east});
  node["kerb"](${south},${west},${north},${east});
  node["tactile_paving"](${south},${west},${north},${east});
  way["tactile_paving"](${south},${west},${north},${east});

  node["wheelchair"](${south},${west},${north},${east});
  way["wheelchair"](${south},${west},${north},${east});

  node["highway"="elevator"](${south},${west},${north},${east});
  way["highway"="elevator"](${south},${west},${north},${east});
  node["lift"](${south},${west},${north},${east});

  way["highway"="pedestrian"](${south},${west},${north},${east});
  node["ramp"](${south},${west},${north},${east});
  way["ramp"](${south},${west},${north},${east});
);
out body geom;
`.trim();
}

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "OverpassError";
  }
}

/** Fetch OSM accessibility features inside a bounding box (cached). */
export async function fetchOSMFeatures(
  bbox: RouteBoundingBox
): Promise<OverpassResponse> {
  const key = bboxCacheKey(bbox);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": serverEnv.osm.userAgent,
      },
      body: `data=${encodeURIComponent(buildOverpassQuery(bbox))}`,
      signal: controller.signal,
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      throw new OverpassError(
        `Overpass query failed (${res.status})`,
        res.status
      );
    }

    const data = (await res.json()) as OverpassResponse;
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    if (err instanceof OverpassError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OverpassError("Overpass request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Clear in-memory Overpass cache (testing). */
export function clearOverpassCache(): void {
  cache.clear();
}
