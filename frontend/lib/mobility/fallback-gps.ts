import type { GpsLocation } from "@/lib/mobility/sensors";

/**
 * Fallback coordinates for hazard reports that have no live GPS. The landmark id
 * comes from HAZARD_REPORT_FALLBACK_LOCATION and may be a well-known London
 * landmark name or a raw "lat,lng" string.
 */
const LANDMARKS: Record<string, GpsLocation> = {
  barbican: { latitude: 51.5203, longitude: -0.0972 },
  moorgate: { latitude: 51.5186, longitude: -0.0886 },
  bank: { latitude: 51.5133, longitude: -0.0886 },
  "st paul's": { latitude: 51.5146, longitude: -0.0973 },
  "st pauls": { latitude: 51.5146, longitude: -0.0973 },
  "liverpool street": { latitude: 51.5178, longitude: -0.0823 },
  "tower hill": { latitude: 51.5099, longitude: -0.0766 },
  aldgate: { latitude: 51.5143, longitude: -0.0755 },
  farringdon: { latitude: 51.5203, longitude: -0.1053 },
  "triton square": { latitude: 51.5258, longitude: -0.1417 },
};

export function fallbackGpsForLandmark(landmarkId: string): GpsLocation | null {
  if (!landmarkId) return null;
  const key = landmarkId.trim().toLowerCase();
  if (LANDMARKS[key]) return LANDMARKS[key];

  const m = key.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    return { latitude: Number.parseFloat(m[1]), longitude: Number.parseFloat(m[2]) };
  }
  return null;
}

export function formatFallbackLocationSummary(
  gps: GpsLocation,
  landmarkId: string
): string {
  return `Using fallback location "${landmarkId}" (${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)})`;
}
