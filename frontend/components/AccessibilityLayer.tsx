"use client";

import { CircleMarker, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import type { OSMRiskyFeature } from "@/services/osm/types";

export interface MapLayerVisibility {
  routes: boolean;
  crossings: boolean;
  steps: boolean;
  tactilePaving: boolean;
  riskPoints: boolean;
  crimeIncidents: boolean;
}

export interface AccessibilityLayerProps {
  routes: Array<{
    id: string;
    riskyFeatures: OSMRiskyFeature[];
    osmContext: {
      mapFeatures: {
        crossings: OSMRiskyFeature[];
        steps: OSMRiskyFeature[];
        tactilePaving: OSMRiskyFeature[];
        riskPoints: OSMRiskyFeature[];
      };
    } | null;
  }>;
  layers: MapLayerVisibility;
  highContrast?: boolean;
}

const SEVERITY_COLORS: Record<
  OSMRiskyFeature["severity"],
  { fill: string; stroke: string }
> = {
  risk: { fill: "#ef4444", stroke: "#fca5a5" },
  caution: { fill: "#eab308", stroke: "#fde047" },
  support: { fill: "#22c55e", stroke: "#86efac" },
};

function FeatureMarker({
  feature,
  highContrast,
}: {
  feature: OSMRiskyFeature;
  highContrast?: boolean;
}) {
  const colors = SEVERITY_COLORS[feature.severity];
  const radius = highContrast ? 10 : 8;
  const weight = highContrast ? 3 : 2;

  return (
    <CircleMarker
      center={[feature.lat, feature.lng]}
      radius={radius}
      pathOptions={{
        color: colors.stroke,
        fillColor: colors.fill,
        fillOpacity: highContrast ? 0.95 : 0.85,
        weight,
      }}
    >
      <Popup>
        <div className="min-w-[160px] text-sm">
          <p className="font-semibold capitalize text-slate-900">
            {feature.type.replace(/_/g, " ")}
          </p>
          <p className="mt-1 text-slate-700">{feature.reason}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Source: OpenStreetMap
          </p>
        </div>
      </Popup>
    </CircleMarker>
  );
}

function dedupeFeatures(features: OSMRiskyFeature[]): OSMRiskyFeature[] {
  const seen = new Set<string>();
  return features.filter((f) => {
    const key = `${f.type}-${f.lat.toFixed(5)}-${f.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AccessibilityLayer({
  routes,
  layers,
  highContrast,
}: AccessibilityLayerProps) {
  const allCrossings = dedupeFeatures(
    routes.flatMap((r) => r.osmContext?.mapFeatures.crossings ?? [])
  );
  const allSteps = dedupeFeatures(
    routes.flatMap((r) => r.osmContext?.mapFeatures.steps ?? [])
  );
  const allTactile = dedupeFeatures(
    routes.flatMap((r) => r.osmContext?.mapFeatures.tactilePaving ?? [])
  );
  const allRisk = dedupeFeatures(
    routes.flatMap((r) => [
      ...(r.riskyFeatures ?? []),
      ...(r.osmContext?.mapFeatures.riskPoints ?? []),
    ])
  );

  return (
    <>
      {layers.crossings &&
        allCrossings.map((f) => (
          <FeatureMarker
            key={`cross-${f.lat}-${f.lng}-${f.type}`}
            feature={f}
            highContrast={highContrast}
          />
        ))}
      {layers.steps &&
        allSteps.map((f) => (
          <FeatureMarker
            key={`step-${f.lat}-${f.lng}`}
            feature={f}
            highContrast={highContrast}
          />
        ))}
      {layers.tactilePaving &&
        allTactile.map((f) => (
          <FeatureMarker
            key={`tactile-${f.lat}-${f.lng}-${f.type}`}
            feature={f}
            highContrast={highContrast}
          />
        ))}
      {layers.riskPoints &&
        allRisk.map((f) => (
          <FeatureMarker
            key={`risk-${f.lat}-${f.lng}-${f.type}`}
            feature={f}
            highContrast={highContrast}
          />
        ))}
    </>
  );
}

/** Fit map bounds when routes change. */
export function MapBoundsUpdater({
  bounds,
}: {
  bounds: L.LatLngBoundsExpression | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
  }, [bounds, map]);

  return null;
}

export function createEndpointIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:${color};
      color:#0f172a;
      font-weight:700;
      font-size:12px;
      min-width:24px;
      height:24px;
      border-radius:9999px;
      display:flex;
      align-items:center;
      justify-content:center;
      border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    ">${label}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function EndpointMarker({
  position,
  label,
  color,
  title,
}: {
  position: [number, number];
  label: string;
  color: string;
  title: string;
}) {
  return (
    <Marker
      position={position}
      icon={createEndpointIcon(label, color)}
      title={title}
      alt={title}
    >
      <Popup>
        <strong>{title}</strong>
      </Popup>
    </Marker>
  );
}
