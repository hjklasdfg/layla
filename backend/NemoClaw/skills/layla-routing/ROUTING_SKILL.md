# Layla — Routing Skill (interface spec)

Plans **scored, map-ready accessible routes** over the City-of-London fused
graph. Approach A: a preference-weighted path search → genuinely different
geometry per persona, each scored. Reads data from the sibling `layla-data`
skill (`../layla-data`, override with `LAYLA_DATA_DIR`).

Implementation: `route_scoring.py` (`get_scored_routes`) + `route_engine.py`
(weighted Dijkstra) + `mobility_plan_server.py` (HTTP delivery channel).

## `get_scored_routes(start, end, profile="general") -> {start, end, recommended_id, routes[]}`
- `start` / `end` = City place name (built-in gazetteer) | `"lat,lon"` | `(lat, lon)`
- `profile` ∈ `general | blind | wheelchair | elderly | night_safety`

Each route is frontend `MobilityRouteState`-compatible:
```
{ id, variant, start:{lat,lng}, end:{lat,lng}, etaMin, distanceM,
  geometry:{ coordinates:[[lat,lng],...] },            // Leaflet order
  score, signals:{accessibility,safety,comfort}, evidence[],
  mapFeatures:{crossings,steps,tactilePaving,riskPoints} }
```
`recommended_id` = the route planned with the profile's own weights.

## Scoring (current rules — being redesigned)
Per route, from the path:
- **accessibility** = 100 − steps·20 − incline·8 − max(0, crossings − tactile)·4   (OSM)
- **safety** = 2000 / (crime_avg + 20)   (saturating; data.police.uk crime)
- **comfort** = 100 − noise_avg·40 − dark·4 − crossings·1.5   (DEFRA noise + OSM lighting)
- **score** = profile-weighted blend of the three (`SCORE_W`)

Per-profile routing weights live in `route_scoring.ROUTE_PROFILES` (multipliers
on steps / tactile / crime / darkness / noise in `route_engine._edge_cost`).

> The signal set + weights + recommendation logic are being redesigned (see
> `docs/superpowers/specs/`). The frontend display metrics will follow that design.

## `POST /mobility/plan` (agent / frontend delivery channel)
`mobility_plan_server.py` — receives the frontend's `BackendMobilityPlanRequest`
(`{journey:{start,destination}, preference:{profile,priority}, ...}`), calls
`get_scored_routes`, and returns a `BackendMobilityPlanResponse`
(`routes: MobilityRouteState[]`, `enrichedRoutes`, `recommendation`,
`explanation{uiText,voiceText}`, `meta`). Frontend signal vocabulary
(`accessibility/stress/reliability/predictability/crowding/crossingComplexity`)
is mapped from our `{accessibility,safety,comfort}` in `_signals()`.

Run: `python mobility_plan_server.py` (`:8000`); set frontend `BACKEND_API_URL` to it.
`plan()` is the seam — swap its `get_scored_routes` call for a NemoClaw agent later.

## Env
- `LAYLA_DATA_DIR` — location of the `layla-data` skill (default `../layla-data`).
- `PORT` — mobility_plan_server port (default 8000).
- `TFL_APP_KEY` — only if the agent also calls live TfL via layla-data; routing itself needs no key.
