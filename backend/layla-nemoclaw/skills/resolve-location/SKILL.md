---
name: resolve-location
description: >
  Resolve GPS coordinates to a human-readable street address using OpenStreetMap
  Nominatim. Use as skill 2 after image analysis when lat/lng are known.
---

# Skill 2 — Resolve Location (Geoweb)

| Tool | Input | Returns |
|---|---|---|
| `run(lat, lng)` | WGS84 coordinates | `{lat, lng, display_name, road, borough, postcode, country, source}` |

```bash
python3 scripts/query.py resolve_location 51.5308 -0.1238
```

Env: `NOMINATIM_URL`, `NOMINATIM_USER_AGENT`.
