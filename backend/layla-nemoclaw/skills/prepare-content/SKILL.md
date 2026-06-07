---
name: prepare-content
description: >
  Assemble structured hazard report content from VLM analysis and resolved
  location — headline, facts, accessibility impact, location summary. Use as
  skill 4 before drafting the email.
---

# Skill 4 — Prepare Content

| Tool | Input | Returns |
|---|---|---|
| `run(hazard, location, user_profile?)` | outputs from skills 1 + 2 | `{headline, description, accessibility_impact, location_summary, facts[], gps, ...}` |

```bash
# stdin JSON: {"hazard":{...},"location":{...},"user_profile":"wheelchair"}
echo '{"hazard":{"hazard_type":"pothole","severity":"high"},"location":{"road":"Fleet St","borough":"City of London","lat":51.51,"lng":-0.11}}' | python3 scripts/query.py prepare_content
```
