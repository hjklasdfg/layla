---
name: layla-nemoclaw
description: >
  Five independent skills for road hazard reporting: VLM image analysis, GPS
  geocoding, authority web search, report content assembly, and email draft.
---

# Layla NemoClaw — Five Skills

| # | Skill | Tool |
|---|---|---|
| 1 | `skills/analyse-image/` | `run(image_path)` |
| 2 | `skills/resolve-location/` | `run(lat, lng)` |
| 3 | `skills/search-authority/` | `run(location, hazard_type)` |
| 4 | `skills/prepare-content/` | `run(hazard, location)` |
| 5 | `skills/prepare-email/` | `run(content, authority)` |

```bash
export LAYLA_NEMOCLAW_DEMO=1
python3 scripts/query.py analyse_image /path/to/photo.jpg
python3 server.py   # POST /hazard/report  SSE /hazard/report/stream  :8002
```
