export type TactilePaving = "none" | "partial" | "continuous";
export type WheelchairAccess = "none" | "partial" | "full";

/** Legacy mock / Valhalla context — used by compose and path-search. */
export interface LegacyOSMRouteContext {
  crossings: number;
  footways: number;
  steps: number;
  tactilePaving: TactilePaving;
  wheelchairAccessible: WheelchairAccess;
}

/** @deprecated Use LegacyOSMRouteContext */
export type OSMRouteContext = LegacyOSMRouteContext;

export interface OSMNormalized {
  accessibilityImpact: number;
  stressImpact: number;
  crossingComplexity: number;
  evidence: string[];
}

/** Overpass bbox request. */
export interface RouteBoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Map-ready route polyline — [latitude, longitude] pairs. */
export interface RouteGeometry {
  coordinates: [number, number][];
}

export interface MapCoordinate {
  lat: number;
  lng: number;
}

export type OSMFeatureSeverity = "risk" | "caution" | "support";

export interface OSMRiskyFeature {
  type: string;
  lat: number;
  lng: number;
  reason: string;
  severity: OSMFeatureSeverity;
}

/** Enriched OSM context from Overpass — used by scoring and map layers. */
export interface OSMEnrichedContext {
  crossingCount: number;
  trafficSignalCount: number;
  footwayCount: number;
  stepsCount: number;
  kerbCount: number;
  tactilePavingCount: number;
  wheelchairTaggedCount: number;
  riskyFeatures: OSMRiskyFeature[];
  evidence: string[];
  /** Grouped features for map layer toggles. */
  mapFeatures: {
    crossings: OSMRiskyFeature[];
    steps: OSMRiskyFeature[];
    tactilePaving: OSMRiskyFeature[];
    riskPoints: OSMRiskyFeature[];
  };
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}
