---
name: search-authority
description: >
  Web search for the local council or highways team responsible for the reported
  hazard type at the resolved location. Use as skill 3 after location is known.
---

# Skill 3 — Search Authority

| Tool | Input | Returns |
|---|---|---|
| `run(location, hazard_type)` | location dict from skill 2 + hazard type string | `{authority_name, department, email, source, query, search_results[]}` |

```bash
python3 scripts/query.py search_authority "City of London" pothole
```

Uses **DuckDuckGo** HTML search via `requests` — no API key required.
