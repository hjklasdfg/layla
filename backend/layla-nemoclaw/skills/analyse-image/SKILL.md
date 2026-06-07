---
name: analyse-image
description: >
  Analyse a road or pavement photo with a vision-language model. Returns hazard
  type, severity, description, accessibility impact, and confidence. Use as
  skill 1 in the hazard report pipeline.
---

# Skill 1 — Analyse Image (VLM)

| Tool | Input | Returns |
|---|---|---|
| `run(image_path)` | local image path | `{hazard_detected, hazard_type, severity, description, accessibility_impact, confidence, model}` |

```bash
python3 scripts/query.py analyse_image /path/to/photo.jpg
```

Env: `LAYLA_VLM_MODEL`, `LAYLA_NEMOCLAW_DEMO=1` for CPU demo without weights.
