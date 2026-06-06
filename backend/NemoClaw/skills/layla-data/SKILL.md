---
name: layla-data
description: >
  Access ingested City-of-London open data for accessibility-aware route
  building: an OSM walkable graph with fused per-edge attributes (accessibility,
  crime, noise), plus crime/noise/air queries and live TfL lift/crowding.
  Use whenever the agent needs map, safety, or accessibility data for a London
  location, or needs the fused walkable graph to hand to the routing layer.
  Does NOT do routing — it returns the graph + data for the router to weight.
---

# Layla — City-of-London Data Skill

This skill exposes **locally-ingested raw open data**, fused on-device, through a
small set of tools. Routing is handled elsewhere; this skill provides the data.

## What it provides (ingested raw, fused locally)
- **Walkable graph** (OSM footways) with per-edge attributes
- **Accessibility** points (crossings / tactile paving / kerbs / steps)
- **Crime** points (Met/City Police, 25 months)
- **Noise** (DEFRA road-noise dB bands)
- **Air** (London Air monitoring sites — coarse; not per-street)
- **Live TfL** (lift outages, station crowding)

Scope: City-of-London corridor first. Coordinates are WGS84. `bbox = (west, south, east, north)`.

## Tools (implemented in `layla_data_skill.py`)
Call these functions; each returns JSON.

| Tool | Input | Returns | When to use |
|---|---|---|---|
| `get_walkable_graph(bbox)` | bbox | nodes + edges; each edge `{length_m, highway, lit, is_steps, crime_count, noise_db, air_index}` | **The routing handoff** — give this to the routing layer to weight + search. |
| `get_context(lat, lon, radius_m=150)` | point | nearby accessibility + crime count + noise + air | "What's around me" at a point (situational query). |
| `get_accessibility(bbox)` | bbox | crossings/tactile/kerb/steps + tags | Inspect street accessibility features in an area. |
| `get_crime(bbox, since=None)` | bbox | crime points + breakdown by type | Safety layer for an area. |
| `get_noise(lat, lon)` | point | road-noise dB band | Noise at a specific point. |
| `get_air(lat, lon)` | point | nearest air index (coarse) | Area air-quality hint (not per-street). |
| `get_live_disruptions()` | — | TfL lift outages | Real-time step-free breakage. |
| `get_crowding(naptan)` | station id | live crowding % | Station busyness (proxy for footfall). |

## Three-layer accessibility (important)
Accessibility is split across three places — use all three:
1. **Station / transit** → handled by **TfL** (the routing layer passes `accessibilityPreference`, e.g. `StepFreeToVehicle`). Not this skill.
2. **Street / pavement** (tactile paving, dropped kerbs, steps) → **this skill** via `get_walkable_graph` edge attributes (`is_steps`, nearby accessibility points).
3. **Real-time lift status** → **this skill** via `get_live_disruptions()` — overlay to correct TfL's static step-free assumption (a "step-free" station whose lift is broken today).

## How to invoke
- Python: `import layla_data_skill as data; data.get_walkable_graph((-0.100,51.515,-0.090,51.522))`
- Or expose over MCP / HTTP for remote agents.
- Env: set `TFL_APP_KEY` to enable live `get_live_disruptions` / `get_crowding` (falls back to cached snapshots without it).

## Boundaries (do NOT)
- Do **not** route in this skill — return `get_walkable_graph` and let the routing layer weight + search.
- Do **not** use `get_air` for per-street decisions (monitoring sites are sparse; it's area-level only).
- Stay within the ingested corridor; out-of-area queries return little/no data.
