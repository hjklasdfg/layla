# Skill Card — layla-routing

| Field | Value |
|---|---|
| **Name** | layla-routing |
| **Version** | 0.1.0 |
| **Owner** | Team Layla — Data (Linyi Li) |
| **Status** | Hackathon build (City-of-London borough) |
| **Summary** | Plans scored, map-ready, per-persona accessible walking routes (Approach A: preference-weighted graph search → different geometry per profile). Returns frontend `MobilityRouteState`-compatible routes + a recommendation. |
| **Executable** | `route_scoring.py` (`get_scored_routes`) + `route_engine.py`; `mobility_plan_server.py` (HTTP `/mobility/plan` delivery channel). Pure-Python. |
| **Depends on** | sibling **`layla-data`** skill (`../layla-data`) for fused data layers + helpers |

## Capabilities
- `get_scored_routes(start, end, profile)` — the route-planning tool
- `POST /mobility/plan` — agent/frontend delivery channel (`mobility_plan_server.py`)

## Data sources
Indirect, via `layla-data`: OpenStreetMap (graph + accessibility), data.police.uk
(crime), DEFRA noise, London Air. Licences listed in `layla-data/skill-card.md`.

## Governance / safety
- Read-only; no user PII stored.
- Routing weights are heuristic (`ROUTE_PROFILES`) — see `ROUTING_SKILL.md`.
- `_graph_cache.pkl` is a runtime cache (gitignored), rebuilt when `layla-data` footways change.

## Not included
- Turn-by-turn navigation, GPS following.
- Out-of-borough coverage (needs a larger OSM ingest in `layla-data`).
