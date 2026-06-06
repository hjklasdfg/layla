"use client";

import { useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";
import type { CrimeIncident, CrimeIncidentMeta } from "@/lib/crime/types";
import type { MobilityRouteState } from "@/lib/mobilityEngine";
import {
  AccessibilityLayer,
  EndpointMarker,
  MapBoundsUpdater,
  type MapLayerVisibility,
} from "./AccessibilityLayer";
import "leaflet/dist/leaflet.css";

const ROUTE_COLORS: Record<string, string> = {
  A: "#22d3ee",
  B: "#a78bfa",
  C: "#34d399",
  D: "#fb923c",
};

const DEFAULT_LAYERS: MapLayerVisibility = {
  routes: true,
  crossings: true,
  steps: true,
  tactilePaving: true,
  riskPoints: true,
  crimeIncidents: true,
};

const CRIME_TYPE_COLORS: Record<string, string> = {
  "Violence and sexual offences": "#ef4444",
  Robbery: "#dc2626",
  "Possession of weapons": "#b91c1c",
  "Theft from the person": "#f97316",
  "Other theft": "#fb923c",
  Shoplifting: "#f59e0b",
  Burglary: "#a855f7",
  Drugs: "#14b8a6",
  "Vehicle crime": "#38bdf8",
  "Bicycle theft": "#22d3ee",
  "Public order": "#eab308",
  "Anti-social behaviour": "#84cc16",
  "Criminal damage and arson": "#f43f5e",
  "Other crime": "#ec4899",
};

interface CrimeLocation {
  id: string;
  latitude: number;
  longitude: number;
  location: string;
  total: number;
  types: Record<string, number>;
  outcomes: Record<string, number>;
}

export interface RouteMapProps {
  routes: MobilityRouteState[];
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  startLabel?: string;
  endLabel?: string;
  highContrast?: boolean;
  crimeIncidents?: CrimeIncident[];
  crimeMeta?: CrimeIncidentMeta | null;
}

function LayerToggle({
  label,
  checked,
  onChange,
  colorClass,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  colorClass: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-600/60 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-cyan-400"
      />
      <span className={`h-2 w-2 rounded-full ${colorClass}`} />
      {label}
    </label>
  );
}

function incrementCount(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function dominantEntry(counts: Record<string, number>): [string, number] {
  return (
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["Unknown", 0]
  );
}

function CrimeIncidentLayer({
  locations,
  highContrast,
}: {
  locations: CrimeLocation[];
  highContrast?: boolean;
}) {
  return (
    <>
      {locations.map((location) => {
        const [dominantType, dominantCount] = dominantEntry(location.types);
        const topOutcomes = Object.entries(location.outcomes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        const color = CRIME_TYPE_COLORS[dominantType] ?? "#ec4899";
        const radius = Math.min(
          highContrast ? 24 : 20,
          (highContrast ? 7 : 5) + Math.sqrt(location.total) * 3
        );

        return (
          <CircleMarker
            key={location.id}
            center={[location.latitude, location.longitude]}
            radius={radius}
            pathOptions={{
              color: highContrast ? "#ffffff" : color,
              fillColor: color,
              fillOpacity: highContrast ? 0.78 : 0.58,
              opacity: highContrast ? 0.95 : 0.8,
              weight: highContrast ? 3 : 2,
            }}
          >
            <Tooltip sticky className="!text-xs !font-semibold">
              {location.total} incident{location.total !== 1 ? "s" : ""} ·{" "}
              {location.location}
            </Tooltip>
            <Popup>
              <div className="min-w-[210px] text-sm">
                <p className="font-semibold text-slate-900">
                  {location.total} incident{location.total !== 1 ? "s" : ""}
                </p>
                <p className="mt-1 text-slate-700">{location.location}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-700">
                  <p>
                    <span className="font-medium">Top type:</span> {dominantType}{" "}
                    ({dominantCount})
                  </p>
                  {topOutcomes.length > 0 && (
                    <p>
                      <span className="font-medium">Outcome:</span>{" "}
                      {topOutcomes
                        .map(([outcome, count]) => `${outcome} (${count})`)
                        .join("; ")}
                    </p>
                  )}
                </div>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Source: City of London Police street-level crime, Apr 2026
                </p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function RouteMap({
  routes,
  selectedRouteId,
  onRouteSelect,
  startLabel = "Start",
  endLabel = "Destination",
  highContrast: highContrastProp = false,
  crimeIncidents = [],
  crimeMeta = null,
}: RouteMapProps) {
  const [layers, setLayers] = useState<MapLayerVisibility>(DEFAULT_LAYERS);
  const highContrast = highContrastProp;

  const start = routes[0]?.start;
  const end = routes[0]?.end;
  const crimeLocations = useMemo(() => {
    const grouped = new Map<string, CrimeLocation>();

    crimeIncidents.forEach((incident) => {
      const key = `${incident.latitude.toFixed(6)}-${incident.longitude.toFixed(6)}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.total += 1;
        incrementCount(existing.types, incident.crimeType);
        incrementCount(existing.outcomes, incident.outcome);
        return;
      }

      grouped.set(key, {
        id: key,
        latitude: incident.latitude,
        longitude: incident.longitude,
        location: incident.location,
        total: 1,
        types: { [incident.crimeType]: 1 },
        outcomes: { [incident.outcome]: 1 },
      });
    });

    return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  }, [crimeIncidents]);
  const hasCrimeLayer = crimeLocations.length > 0;

  const bounds = useMemo((): L.LatLngBoundsExpression | null => {
    const routeCoords = routes.flatMap((r) => r.geometry.coordinates);
    const crimeCoords = crimeLocations.map(
      (incident) => [incident.latitude, incident.longitude] as [number, number]
    );
    const allCoords = [...routeCoords, ...crimeCoords];

    if (allCoords.length === 0) return null;
    return L.latLngBounds(allCoords);
  }, [crimeLocations, routes]);

  const mapCenter = useMemo((): [number, number] => {
    if (start) return [start.lat, start.lng];
    const first = routes[0]?.geometry.coordinates[0];
    if (first) return first;
    const firstCrime = crimeLocations[0];
    if (firstCrime) return [firstCrime.latitude, firstCrime.longitude];
    return [51.5155, -0.0922];
  }, [crimeLocations, start, routes]);

  if (routes.length === 0 && !hasCrimeLayer) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/60">
        <p className="font-mono text-xs text-slate-500">
          Map loads when routes are available
        </p>
      </div>
    );
  }

  const tileUrl = highContrast
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${
        highContrast
          ? "border-white/30 ring-2 ring-white/10"
          : "border-slate-700/60"
      }`}
    >
      <div
        className="absolute left-3 top-3 z-[1000] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2"
        role="group"
        aria-label="Map layer toggles"
      >
        <LayerToggle
          label="Routes"
          checked={layers.routes}
          onChange={(v) => setLayers((p) => ({ ...p, routes: v }))}
          colorClass="bg-cyan-400"
        />
        <LayerToggle
          label="Crossings"
          checked={layers.crossings}
          onChange={(v) => setLayers((p) => ({ ...p, crossings: v }))}
          colorClass="bg-yellow-400"
        />
        <LayerToggle
          label="Steps"
          checked={layers.steps}
          onChange={(v) => setLayers((p) => ({ ...p, steps: v }))}
          colorClass="bg-red-400"
        />
        <LayerToggle
          label="Tactile"
          checked={layers.tactilePaving}
          onChange={(v) => setLayers((p) => ({ ...p, tactilePaving: v }))}
          colorClass="bg-green-400"
        />
        <LayerToggle
          label="Risk"
          checked={layers.riskPoints}
          onChange={(v) => setLayers((p) => ({ ...p, riskPoints: v }))}
          colorClass="bg-red-500"
        />
        {hasCrimeLayer && (
          <LayerToggle
            label="Crime"
            checked={layers.crimeIncidents}
            onChange={(v) => setLayers((p) => ({ ...p, crimeIncidents: v }))}
            colorClass="bg-orange-400"
          />
        )}
      </div>

      <MapContainer
        center={mapCenter}
        zoom={14}
        className="h-[360px] w-full sm:h-[420px]"
        scrollWheelZoom
        aria-label="Interactive route map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url={tileUrl}
        />

        {bounds && <MapBoundsUpdater bounds={bounds} />}

        {start && (
          <EndpointMarker
            position={[start.lat, start.lng]}
            label="A"
            color="#22d3ee"
            title={startLabel}
          />
        )}
        {end && (
          <EndpointMarker
            position={[end.lat, end.lng]}
            label="B"
            color="#f472b6"
            title={endLabel}
          />
        )}

        {layers.routes &&
          routes.map((route) => {
            const isSelected =
              !selectedRouteId || route.id === selectedRouteId;
            const color = ROUTE_COLORS[route.id] ?? "#94a3b8";
            return (
              <Polyline
                key={route.id}
                positions={route.geometry.coordinates}
                pathOptions={{
                  color,
                  weight: isSelected ? 6 : 3,
                  opacity: isSelected ? 0.95 : 0.45,
                  lineCap: "round",
                  lineJoin: "round",
                }}
                eventHandlers={{
                  click: () => onRouteSelect?.(route.id),
                }}
              >
                <Tooltip sticky className="!text-xs !font-semibold">
                  Route {route.id} · {route.etaMin} min
                </Tooltip>
              </Polyline>
            );
          })}

        <AccessibilityLayer
          routes={routes}
          layers={layers}
          highContrast={highContrast}
        />

        {layers.crimeIncidents && hasCrimeLayer && (
          <CrimeIncidentLayer
            locations={crimeLocations}
            highContrast={highContrast}
          />
        )}
      </MapContainer>

      <div className="flex flex-wrap gap-3 border-t border-slate-700/50 bg-slate-950/80 px-3 py-2">
        {routes.map((route) => {
          const color = ROUTE_COLORS[route.id] ?? "#94a3b8";
          const active = route.id === selectedRouteId;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => onRouteSelect?.(route.id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition ${
                active
                  ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              aria-pressed={active}
            >
              <span
                className="h-2.5 w-6 rounded-full"
                style={{ backgroundColor: color }}
              />
              Route {route.id} · {route.etaMin} min
            </button>
          );
        })}
        {hasCrimeLayer && crimeMeta && (
          <span className="self-center rounded-md border border-orange-400/25 bg-orange-500/10 px-2 py-1 text-[10px] font-medium text-orange-100">
            Crime map · {crimeMeta.mappedCount} mapped ·{" "}
            {crimeLocations.length} location
            {crimeLocations.length !== 1 ? "s" : ""}
            {crimeMeta.unmappedCount > 0
              ? ` · ${crimeMeta.unmappedCount} without location`
              : ""}
          </span>
        )}
        <span className="ml-auto self-center text-[10px] text-slate-500">
          Red=risk · Yellow=caution · Green=support · Orange=crime incidents
        </span>
      </div>
    </div>
  );
}
