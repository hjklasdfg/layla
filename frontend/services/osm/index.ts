export type {
  LegacyOSMRouteContext,
  OSMEnrichedContext,
  OSMNormalized,
  OSMRiskyFeature,
  OverpassResponse,
  RouteBoundingBox,
  RouteGeometry,
  MapCoordinate,
  TactilePaving,
  WheelchairAccess,
} from "./types";

export { normalizeOSMData } from "./normalize";
export { normalizeOSMFeatures } from "./osmNormalize";
export { fetchOSMFeatures, OverpassError } from "./overpass";
export { getMockOSMContext } from "./mock-data";
export { searchValhallaFootRoutes, deriveContextFromValhalla } from "./valhalla-routing";
export {
  searchFootRoutes,
  type FootRoute,
  type RouteGeometry as OSRMRouteGeometry,
} from "./routing";
export { searchOSMPaths, type OSMPathSearchResult } from "./path-search";
