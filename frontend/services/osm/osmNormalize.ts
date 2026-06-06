import type {
  OSMEnrichedContext,
  OSMFeatureSeverity,
  OSMRiskyFeature,
  OverpassElement,
  OverpassResponse,
} from "./types";

function elementCoordinate(
  element: OverpassElement
): { lat: number; lng: number } | null {
  if (element.lat !== undefined && element.lon !== undefined) {
    return { lat: element.lat, lng: element.lon };
  }
  const geom = element.geometry?.[0];
  if (geom) return { lat: geom.lat, lng: geom.lon };
  return null;
}

function addFeature(
  list: OSMRiskyFeature[],
  element: OverpassElement,
  type: string,
  reason: string,
  severity: OSMFeatureSeverity
): void {
  const coord = elementCoordinate(element);
  if (!coord) return;
  list.push({ type, lat: coord.lat, lng: coord.lng, reason, severity });
}

function isTactile(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  return (
    tags.tactile_paving === "yes" ||
    tags["crossing:markings"] === "lines" ||
    tags.surface === "tactile" ||
    tags.tactile_paving !== undefined
  );
}

function isWheelchairYes(element: OverpassElement): boolean {
  return element.tags?.wheelchair === "yes";
}

function isSteps(element: OverpassElement): boolean {
  return element.tags?.highway === "steps";
}

function isCrossing(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  return tags.highway === "crossing" || tags.crossing !== undefined;
}

function isTrafficSignal(element: OverpassElement): boolean {
  return element.tags?.highway === "traffic_signals";
}

function isFootway(element: OverpassElement): boolean {
  const tags = element.tags ?? {};
  return (
    tags.highway === "footway" ||
    tags.footway !== undefined ||
    tags.sidewalk !== undefined ||
    tags.highway === "pedestrian"
  );
}

function isKerb(element: OverpassElement): boolean {
  return element.tags?.kerb !== undefined;
}

function isRamp(element: OverpassElement): boolean {
  return element.tags?.ramp !== undefined || element.tags?.highway === "elevator";
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToRouteMeters(
  lat: number,
  lng: number,
  route: [number, number][]
): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) {
    return haversineMeters(lat, lng, route[0][0], route[0][1]);
  }

  let min = Infinity;
  for (let i = 0; i < route.length - 1; i += 1) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    min = Math.min(
      min,
      haversineMeters(lat, lng, lat1, lng1),
      haversineMeters(lat, lng, lat2, lng2),
      haversineMeters(lat, lng, midLat, midLng)
    );
  }
  return min;
}

function filterElementsNearRoute(
  elements: OverpassElement[],
  routeCoordinates: [number, number][],
  maxMeters = 120
): OverpassElement[] {
  if (routeCoordinates.length === 0) return elements;

  return elements.filter((element) => {
    const coord = elementCoordinate(element);
    if (!coord) return false;
    return (
      distanceToRouteMeters(coord.lat, coord.lng, routeCoordinates) <=
      maxMeters
    );
  });
}

/** Normalize Overpass response into accessibility context and map features. */
export function normalizeOSMFeatures(
  osmResponse: OverpassResponse,
  routeCoordinates: [number, number][] = []
): OSMEnrichedContext {
  const elements = filterElementsNearRoute(
    osmResponse.elements ?? [],
    routeCoordinates
  );

  let crossingCount = 0;
  let trafficSignalCount = 0;
  let footwayCount = 0;
  let stepsCount = 0;
  let kerbCount = 0;
  let tactilePavingCount = 0;
  let wheelchairTaggedCount = 0;

  const crossings: OSMRiskyFeature[] = [];
  const steps: OSMRiskyFeature[] = [];
  const tactilePaving: OSMRiskyFeature[] = [];
  const riskPoints: OSMRiskyFeature[] = [];

  for (const element of elements) {
    if (isCrossing(element)) {
      crossingCount += 1;
      addFeature(
        crossings,
        element,
        "crossing",
        "Pedestrian crossing",
        "caution"
      );
      if (!isTactile(element)) {
        addFeature(
          riskPoints,
          element,
          "crossing",
          "Crossing without tactile paving data",
          "risk"
        );
      }
    }

    if (isTrafficSignal(element)) {
      trafficSignalCount += 1;
      addFeature(
        crossings,
        element,
        "traffic_signals",
        "Traffic signal at crossing",
        "support"
      );
    }

    if (isFootway(element)) {
      footwayCount += 1;
      if (isWheelchairYes(element)) {
        wheelchairTaggedCount += 1;
        addFeature(
          tactilePaving,
          element,
          "footway",
          "Wheelchair-accessible footway",
          "support"
        );
      }
    }

    if (isSteps(element)) {
      stepsCount += 1;
      addFeature(
        steps,
        element,
        "steps",
        "Steps detected near route",
        "risk"
      );
      addFeature(riskPoints, element, "steps", "Steps on path", "risk");
    }

    if (isKerb(element)) {
      kerbCount += 1;
      const kerbType = element.tags?.kerb ?? "unknown";
      addFeature(
        riskPoints,
        element,
        "kerb",
        `Kerb: ${kerbType}`,
        kerbType === "lowered" || kerbType === "flush" ? "support" : "caution"
      );
    }

    if (isTactile(element)) {
      tactilePavingCount += 1;
      addFeature(
        tactilePaving,
        element,
        "tactile_paving",
        "Tactile paving present",
        "support"
      );
    }

    if (isWheelchairYes(element) && !isFootway(element)) {
      wheelchairTaggedCount += 1;
      addFeature(
        tactilePaving,
        element,
        "wheelchair",
        "Wheelchair access tagged",
        "support"
      );
    }

    if (isRamp(element)) {
      addFeature(
        tactilePaving,
        element,
        "ramp",
        "Ramp or elevator access",
        "support"
      );
    }

    if (element.tags?.wheelchair === "no") {
      addFeature(
        riskPoints,
        element,
        "wheelchair",
        "Not wheelchair accessible",
        "risk"
      );
    }
  }

  const evidence: string[] = [];

  if (stepsCount > 0) {
    evidence.push("Steps detected near this route");
  }
  if (tactilePavingCount === 0 && crossingCount > 0) {
    evidence.push("Crossings found, but tactile paving data is missing");
  }
  if (crossingCount > 3) {
    evidence.push("Multiple crossings may increase complexity");
  }
  if (trafficSignalCount > 0 && crossingCount > 0) {
    evidence.push(`${trafficSignalCount} signalised crossing(s) detected`);
  }
  if (footwayCount > 0) {
    evidence.push(`${footwayCount} footway segment(s) mapped nearby`);
  }
  if (wheelchairTaggedCount > 0) {
    evidence.push(`${wheelchairTaggedCount} wheelchair-accessible feature(s)`);
  }
  if (kerbCount > 0 && kerbCount < crossingCount) {
    evidence.push("Some kerb data missing near crossings");
  }
  if (evidence.length === 0) {
    evidence.push("Limited OSM accessibility data in corridor");
  }

  const riskyFeatures = [...riskPoints, ...steps].slice(0, 80);

  return {
    crossingCount,
    trafficSignalCount,
    footwayCount,
    stepsCount,
    kerbCount,
    tactilePavingCount,
    wheelchairTaggedCount,
    riskyFeatures,
    evidence,
    mapFeatures: {
      crossings: crossings.slice(0, 40),
      steps: steps.slice(0, 30),
      tactilePaving: tactilePaving.slice(0, 30),
      riskPoints: riskPoints.slice(0, 40),
    },
  };
}
