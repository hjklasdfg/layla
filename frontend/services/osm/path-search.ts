import { geocodePlace } from "./geocode";
import { searchValhallaFootRoutes } from "./valhalla-routing";
import type { LegacyOSMRouteContext } from "./types";
import type { RouteGeometry } from "./routing";

export interface OSMPathSearchResult {
  start: { lat: number; lon: number; displayName: string };
  end: { lat: number; lon: number; displayName: string };
  routes: Array<{
    routeIndex: number;
    etaMin: number;
    distanceM: number;
    geometry: RouteGeometry;
    osm: LegacyOSMRouteContext;
  }>;
}

export interface OSMServiceConfig {
  nominatimUrl: string;
  osrmUrl: string;
  overpassUrl: string;
  valhallaUrl: string;
  userAgent: string;
  contactEmail?: string;
}

/**
 * OSM path search: Nominatim geocoding + Valhalla pedestrian routing.
 * No npm "openstreetmap" package — uses public OSM infrastructure via HTTP.
 */
export async function searchOSMPaths(
  startQuery: string,
  destinationQuery: string,
  config: OSMServiceConfig
): Promise<OSMPathSearchResult> {
  const geoOpts = {
    nominatimUrl: config.nominatimUrl,
    userAgent: config.contactEmail
      ? `${config.userAgent}; mailto:${config.contactEmail}`
      : config.userAgent,
  };

  const [start, end] = await Promise.all([
    geocodePlace(startQuery, geoOpts),
    geocodePlace(destinationQuery, geoOpts),
  ]);

  const footRoutes = await searchValhallaFootRoutes(start, end, config.valhallaUrl);

  const routes = footRoutes.map((route, routeIndex) => ({
    routeIndex,
    etaMin: Math.max(1, Math.round(route.durationSec / 60)),
    distanceM: route.distanceM,
    geometry: route.geometry,
    osm: route.osm,
  }));

  return { start, end, routes };
}
