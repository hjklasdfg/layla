# Skill Card — layla-data

| Field | Value |
|---|---|
| **Name** | layla-data |
| **Version** | 0.1.0 |
| **Owner** | Team Layla — Data (Linyi Li) |
| **Status** | Hackathon build (City-of-London corridor) |
| **Summary** | Locally-ingested City-of-London open data, fused on-device, exposed as data tools for an accessibility-aware mobility agent. Provides a fused OSM walkable graph + crime/noise/air/accessibility + live TfL. Routing is out of scope. |
| **Executable** | `layla_data_skill.py` (pure-Python; JSON I/O) |

## Capabilities
- `get_walkable_graph`, `get_context`, `get_accessibility`, `get_crime`, `get_noise`, `get_air`, `get_live_disruptions`, `get_crowding`, `get_line_status`, `get_road_disruptions`

## Data sources & licenses
| Layer | Source | Licence |
|---|---|---|
| Walkable graph + accessibility | OpenStreetMap (Overpass) | ODbL — © OpenStreetMap contributors |
| Crime | data.police.uk (Met / City of London Police) | Open Government Licence v3 |
| Noise | DEFRA strategic noise mapping (London Datastore) | Open Government Licence v3 |
| Air | London Air (Imperial ERG / LAQN) | open, attribution to LAQN |
| Live transit | Transport for London Unified API | "Powered by TfL Open Data" |

## Governance / safety
- Read-only data access; no user PII stored.
- Live calls require `TFL_APP_KEY` (env); without it, returns cached snapshots.
- Coverage bounded to the City-of-London corridor; expand by re-ingesting a larger OSM bbox + adding the Metropolitan Police crime feed.

## Not included (vs NVIDIA-verified skills)
- `skill.oms.sig` (NVIDIA OMS signature) — applies to NVIDIA-verified skills only; this is a local/unverified team skill.
- `evals/` Tier-3 dataset — add later if formal evaluation is needed.
