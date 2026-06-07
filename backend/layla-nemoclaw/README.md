# Layla NemoClaw

Five **independent skills** orchestrated by `agent.py` for hazard reporting.

| Skill | What it does |
|---|---|
| `analyse-image` | VLM classifies hazard in photo |
| `resolve-location` | GPS → address via OSM Nominatim |
| `search-authority` | DuckDuckGo search for council contact |
| `prepare-content` | Structured report facts |
| `prepare-email` | Final to / subject / body |

## Run

```bash
cd backend/layla-nemoclaw
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export LAYLA_NEMOCLAW_DEMO=1

python3 agent.py --image ../../video/images.jpeg --lat 51.5308 --lng -0.1238 --verbose-steps
python3 server.py   # :8002
```

Frontend tries Layla NemoClaw first; falls back to Nebius if unavailable.
