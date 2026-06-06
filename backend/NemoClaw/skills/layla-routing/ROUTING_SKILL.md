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

## Scoring rules (v1 — approved design)
**5 signals per route** (0–100, higher = better), one per data layer:
- **accessibility** = 100 − steps·20 − incline·8 − max(0, crossings − tactile)·4   (OSM)
- **safety** = 100 − crime_avg·0.25   (data.police.uk crime density, City-calibrated)
- **quiet** = 100 − noise_avg·80   (DEFRA road noise)
- **lighting** = 100 − unlit·6   (OSM `lit`)
- **air** = 100 − (index − 1)·10   (London Air; coarse, low weight)

**Two weight sets, both amplified per persona:**
- **Routing weights** (`ROUTE_PROFILES`, edge-cost multipliers in `route_engine._edge_cost`) → shape route GEOMETRY.
- **Scoring weights** (`SCORE_W`, over the 5 signals) → `score = Σ signal·weight`, picks the RECOMMENDED route.

**Recommendation:** generate candidate variants (personalized / fastest / safest /
quietest, deduped) → recommend the **highest-scoring route within the length cap**.
Cap = ≤ `LENGTH_CAP` (1.5×) of the **persona-viable fastest** (for blind/wheelchair/
elderly the baseline is the fastest step-free route, so a steps shortcut doesn't
unfairly exclude accessible routes).

**Strict mode** (`get_scored_routes(..., strict=True)` — the "force full accessibility"
toggle): drops the length cap + (wheelchair/elderly) keeps only step-free routes.

> Frontend display: the card currently maps these 5 into its 6 `AccessibilitySignals`
> slots (`mobility_plan_server._signals`) and also passes the raw 5 as `signals5`.
> Updating `RouteCard` to show the clean 5 is a frontend follow-up.

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
