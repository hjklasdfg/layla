# Layla — Data Skill (interface spec)

One skill the agent (NemoClaw) calls to access ingested City-of-London data AND
to plan **scored, map-ready accessible routes**. We **ingest raw open data, fuse
it locally**, and run a **per-persona weighted route search** over the fused
graph (Approach A: different profile → different geometry).

Implementation: `layla_data_skill.py` (data tools) + `route_scoring.py` /
`route_engine.py` (scored routing); pure-Python, JSON-serialisable I/O.

## Ingested data layers (raw → fused locally)

| Layer | Raw source | File | Granularity |
|---|---|---|---|
| Walkable network | OpenStreetMap (Overpass) | `layla_osm_footways.geojson` | edges (street) |
| Accessibility | OpenStreetMap | `layla_osm_accessibility.geojson` | points (crossings/tactile/kerb/steps) |
| Crime | Met/City Police bulk street data (25 mo) | `crime_cityoflondon_points.geojson` | points + coords |
| Noise | DEFRA strategic noise (reprojected to WGS84) | `noise_road_cityoflondon.geojson` | polygons (dB band) |
| Air quality | London Air (LAQN) | `env/air_index_london.json` | monitoring sites |
| TfL live | TfL Unified API | (live; cached snapshots in `tfl/`) | station |

`bbox` = `(west, south, east, north)` in WGS84 lon/lat. Points are `lat, lon`.

## Functions

### `get_scored_routes(start, end, profile="general") -> {start, end, recommended_id, routes[]}`  ← headline, map-ready
Approach A — weighted path search on the fused graph → **different geometry per persona**, each scored.
`start`/`end` = City place name | `"lat,lon"` | `(lat,lon)`. `profile` ∈ `general|blind|wheelchair|elderly|night_safety`.
Each route is frontend `MobilityRouteState`-compatible:
```
{ id, variant, start:{lat,lng}, end:{lat,lng}, etaMin, distanceM,
  geometry:{ coordinates:[[lat,lng],...] },            // Leaflet order
  score, signals:{accessibility,safety,comfort}, evidence[],
  mapFeatures:{crossings,steps,tactilePaving,riskPoints} }
```
`recommended_id` = the route planned with the profile's own weights. Scoring reuses the
frontend rules (`services/osm/normalize.ts`: steps/tactile/crossing penalties) + our fused
layers (crime → safety, noise/lighting → comfort). Implemented in `route_scoring.py`.

### `get_accessibility(bbox) -> {count, features[]}`
Accessibility points in box. `features[i] = {lat, lon, category, tags}`.

### `get_crime(bbox, since=None) -> {count, by_type{}, points[]}`
Crime points in box + breakdown by type. `points[i] = {lat, lon, type}`.

### `get_noise(lat, lon) -> {noise_db, band}`
Road-noise dB at a point (point-in-polygon). e.g. `{noise_db: 72.45, band: "70.0-74.9"}`.

### `get_air(lat, lon) -> {air_index, nearest_site, dist_m}`
Nearest air-quality index (1–10) to a point.

### `get_walkable_graph(bbox) -> {node_count, edge_count, nodes[], edges[]}`  ← routing consumes this
Walkable graph with **fused per-edge attributes**:
```
edge = { from:[lon,lat], to:[lon,lat], length_m, highway, lit,
         is_steps, crime_count, noise_db, air_index }
```
The routing layer applies per-profile weights to these and runs the path search.

### `get_context(lat, lon, radius_m=150) -> {accessibility_nearby[], crime_count_nearby, noise, air}`
"What's around me" at a point — the agent's quick situational query.

### `get_live_disruptions() -> {source, count, disruptions[]}`
TfL lift outages (step-free breakage). `source` = "live" (if `TFL_APP_KEY` set) or "cached".

### `get_crowding(naptan) -> {source, percentage_of_baseline, time}`
TfL live station crowding (proxy for street busyness).

### `get_line_status(modes="tube,dlr,elizabeth-line,overground") -> {source, count, lines[]}`
TfL line statuses/disruptions. `lines[i] = {line, mode, status, reason}`. Transit reliability signal.

### `get_road_disruptions(bbox=None) -> {source, count, disruptions[]}`
TfL roadworks/closures (live). `disruptions[i] = {severity, category, location, description, lat, lon}`. `bbox=(w,s,e,n)` filters to disruptions whose coords fall in the box.

## Accessibility — three layers (who handles what)

Accessibility is **not one thing** — it's handled in three places. Don't try to
do it all in one layer:

| Aspect | Handled by | How |
|---|---|---|
| **Station / transit** — step-free stations, no stairs between platforms, step-free onto the vehicle | **TfL** | pass `accessibilityPreference` to the Journey Planner per persona: `StepFreeToVehicle` / `StepFreeToPlatform` / `NoSolidStairs` / `NoEscalators` / `NoElevators`. (Verified: it re-routes to step-free stations.) |
| **Street / pavement** — tactile paving, dropped kerbs, crossing type, pavement steps | **us** | weighted routing of the **walking legs** over `get_walkable_graph` (OSM accessibility attributes). TfL has no idea about the pavement. |
| **Real-time lift status** — the "step-free" station's lift is broken today | **us** | `get_live_disruptions()` overlay corrects TfL's *static* step-free assumption |

**Flow:** persona → (1) choose the right TfL `accessibilityPreference` [station layer]
→ (2) re-route the walking legs on our fused graph [street layer]
→ (3) correct with live lift outages [real-time layer].

This is the value-add over TfL: we fill its two blind spots — **street-level
pavement accessibility** and **real-time lift outages** — rather than wrapping it.

## Calling it from NemoClaw

**Option A — register as NemoClaw skills (recommended):** wrap each function as a
tool with a JSON schema; NemoClaw selects + calls them. Example:
```python
import layla_data_skill as data
SKILLS = {
  "get_walkable_graph": data.get_walkable_graph,   # routing handoff
  "get_context":        data.get_context,
  "get_live_disruptions": data.get_live_disruptions,
  # ...
}
```

**Option B — HTTP (any agent):** thin FastAPI wrapper exposing
`POST /skill/{fn}` with a JSON body → calls the function → returns JSON.
NemoClaw (or anything) calls it over the network.

## Env
- `TFL_APP_KEY` — TfL Unified API key (enables live disruptions/crowding; falls back to cached snapshots without it).

## Notes / scope
- City of London corridor first. To expand: re-pull OSM for a larger bbox + add the **Metropolitan Police** force to the crime ingest.
- "Crowd/footfall" at street level has no open real-time API → use `get_crowding` (station proxy) + CV-derived crowd density (separate component).
- All layers verified working (live run): 264 accessibility · 17.5k crime pts · noise dB · LAQN air · 3545-node graph · live TfL.
