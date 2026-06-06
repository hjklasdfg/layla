export interface RouteGeometry {
  /** [longitude, latitude] pairs along the path */
  coordinates: [number, number][];
  distanceM: number;
}

export interface FootRoute {
  durationSec: number;
  distanceM: number;
  geometry: RouteGeometry;
}

interface OSRMResponse {
  code: string;
  routes?: Array<{
    duration: number;
    distance: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }>;
  message?: string;
}

/** Search walking routes via OSRM (OpenStreetMap road network). */
export async function searchFootRoutes(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  osrmUrl: string
): Promise<FootRoute[]> {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${osrmUrl}/route/v1/foot/${coords}?alternatives=3&overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`OSRM routing failed (${res.status})`);
  }

  const data = (await res.json()) as OSRMResponse;
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message ?? "OSRM returned no walking routes");
  }

  return data.routes.map((r) => ({
    durationSec: r.duration,
    distanceM: r.distance,
    geometry: {
      coordinates: r.geometry.coordinates,
      distanceM: r.distance,
    },
  }));
}
