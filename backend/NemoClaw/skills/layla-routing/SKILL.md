---
name: layla-routing
description: >
  Plan scored, map-ready, per-persona accessible walking routes across the City
  of London. Given a start, destination and user profile (general / blind /
  wheelchair / elderly / night_safety), returns several candidate routes with
  genuinely different geometry per profile, each scored, plus a recommended one
  — ready for the frontend map to render. Use whenever the user wants to GO
  somewhere or compare routes. Reads its data from the sibling `layla-data`
  skill; it does not fetch raw data itself.
---

# Layla — Route Planning Skill

Plans **personalised accessible routes** (Approach A: preference-weighted path
search on the fused walkable graph → different geometry per persona, each
scored). Separate from `layla-data` so the data layer stays simple and the agent
has one clear tool for "plan a route".

## Tool
| Tool | Input | Returns |
|---|---|---|
| `get_scored_routes(start, end, profile)` | start/end = place name \| `"lat,lon"` \| `(lat,lon)`; profile ∈ general\|blind\|wheelchair\|elderly\|night_safety | `{start, end, recommended_id, routes[]}` — each route map-ready (frontend `MobilityRouteState`-compatible): `id, variant, etaMin, distanceM, geometry.coordinates ([lat,lng]), score, signals{accessibility,safety,comfort}, evidence[], mapFeatures{crossings,steps,tactilePaving,riskPoints}` |

`recommended_id` = the route planned with the profile's own weights (the personalised one).

## How it plans
- Different **profile → different edge costs → different optimal path** (re-route, not re-rank).
- Per-profile weights penalise: steps, missing tactile paving, crime density, road noise, unlit segments (`route_scoring.ROUTE_PROFILES`).
- Scoring fuses OSM accessibility + crime (safety) + noise/lighting (comfort) — see `ROUTING_SKILL.md`.

## Agent delivery channel
`mobility_plan_server.py` exposes `POST /mobility/plan` returning a
`BackendMobilityPlanResponse` the frontend renders directly. The `plan()`
function is the seam: today it calls `get_scored_routes`; swap it for a NemoClaw
agent call later — the contract is unchanged.

## Dependency
- **Requires the sibling `layla-data` skill** (`../layla-data`) for the data
  layers + helpers. Override its location with env `LAYLA_DATA_DIR`.
- First call builds the graph (~13 s) and caches it to `_graph_cache.pkl`
  (gitignored); later calls reload in ~0.6 s.

## Boundaries
- Coverage = the City of London borough. Out-of-borough origins/destinations (e.g. King's Cross) are not yet routable — expand by re-ingesting a larger OSM bbox in `layla-data`.
- This skill plans routes; it does not do turn-by-turn navigation.
