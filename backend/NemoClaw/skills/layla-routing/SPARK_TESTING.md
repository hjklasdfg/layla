# Testing Layla routing on the DGX Spark

## What's ready vs. what's the GPU step

| | Status |
|---|---|
| Both skills (`layla-data`, `layla-routing`) + backend + frontend | ✅ run as-is on the Spark (CPU) |
| Central-London corridor (Triton Square ↔ City) routing | ✅ works today (~10s build, ~4-6s cross-corridor route) |
| All-London **data** pipeline (`ingest_osm.py` per-bbox, 92k-point all-London crime) | ✅ ready |
| Full **Greater-London routing** (millions of edges) | ⚠️ needs the cuGraph GPU backend — **not wired yet** (Part 2) |

---

## Part 1 — Run the current stack on the Spark (CPU, works today)

```bash
# 1. clone the branch
git clone -b rocky <repo-url> layla && cd layla

# 2. python env (routing is stdlib-only; `requests` only for TfL realtime)
python3 -m venv .venv && source .venv/bin/activate
pip install requests

# 3. routing backend — first run builds the graph (~10s) then pickle-caches it
cd backend/NemoClaw/skills/layla-routing
PORT=8000 python mobility_plan_server.py
#   GET  /health
#   POST /mobility/plan      {journey, preference}
#   POST /mobility/compare   {journey, combos:[{profile,priority}]}

# 4. frontend (new shell, from repo root)
cd frontend
bun install
printf 'BACKEND_API_URL=http://localhost:8000\nTFL_APP_KEY=<your-tfl-key>\n' > .env.local
bun dev        # http://localhost:3000
```

Smoke test:

```bash
curl localhost:8000/health
curl -s -X POST localhost:8000/mobility/plan -H 'Content-Type: application/json' \
  -d '{"preference":{"profile":"wheelchair","priority":"most_accessible"},
       "journey":{"start":"Triton Square","destination":"Aldgate"}}' | head -c 500
```

You should get `meta.source = backend`, walking routes + (if TfL key set) `🚇` transit routes.

---

## Part 2 — All-London + cuGraph (the scale story; next implementation step)

### 2a. Ingest all-London OSM
A single Overpass call for all of Greater London times out — **tile it** (or use a PBF):

```bash
cd backend/NemoClaw/skills/layla-data
# option A: run ingest_osm.py over a grid of bboxes and merge the geojson
BBOX="51.45,-0.25,51.55,-0.10" python ingest_osm.py   # one tile (repeat + merge)
# option B (recommended at scale): Geofabrik PBF + pyrosm/osmium
#   wget https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf
#   parse to the SAME schema: layla_osm_footways.geojson + layla_osm_accessibility.geojson
```

All-London crime is already built (`crime_london_points.geojson`, 92k pts). Re-clip
DEFRA noise to the larger bbox the same way (see `/tmp/convert_noise.py`).

### 2b. cuGraph GPU routing backend — DONE (`route_engine_gpu.py`)
Implemented: only the shortest-path step moves to the GPU; the fused edge weights
(steps / crime / noise / darkness / air) are identical to the CPU path.
`route_engine.shortest()` dispatches to cuGraph when `LAYLA_GPU=1` and falls back
to the CPU Dijkstra on any GPU error (so the demo never breaks).

RAPIDS via the NGC container (verified importable on GB10 / CUDA-13 driver):
```bash
docker run --gpus all -it --rm --user root -v $PWD/layla:/work -w /work \
  nvcr.io/nvidia/rapidsai/base:25.06-cuda12.8-py3.12 bash
```

### 2c. Test GPU vs CPU (inside the container)
```bash
cd /work/backend/NemoClaw/skills/layla-routing
pip install requests >/dev/null 2>&1 || true
rm -f _graph_cache.pkl ../layla-data/_graph_cache.pkl      # rebuild fresh

# correctness + timing — same OD, CPU vs GPU (should return the same route)
LAYLA_GPU=0 python3 -c "import route_scoring as rs,time; rs._graph(); \
  t=time.time(); r=rs.get_scored_routes('Triton Square','Aldgate','wheelchair'); \
  print('CPU %.2fs rec=%s'%(time.time()-t, r['recommended_id']))"
LAYLA_GPU=1 python3 -c "import route_scoring as rs,time; rs._graph(); \
  t=time.time(); r=rs.get_scored_routes('Triton Square','Aldgate','wheelchair'); \
  print('GPU %.2fs rec=%s'%(time.time()-t, r['recommended_id']))"
```

⚠️ **Honest caveat — the speedup shows at SCALE, not on the central corridor.**
Each plan runs 4 variant shortest-paths, and cuGraph rebuilds the graph per call.
On the ~121k-edge corridor that per-call build overhead can make GPU ≈ or slower
than the CPU Dijkstra. The GPU win appears once the graph is **all-London**
(millions of edges, where CPU Dijkstra is tens of seconds). So to demo the win:
do step 2a (ingest all-London OSM) first, then run the CPU-vs-GPU timing above on
that graph. Until then, 2c proves **correctness + that the GPU path runs on the
GB10**, not a speedup.

---

## Nemotron / NemoClaw
The routing skill is the agent's **tool**. The local Nemotron (e.g. Nano 30B
NVFP4) running under NemoClaw calls `POST /mobility/plan` and narrates the result
(ElevenLabs TTS). To test the agent end-to-end, point NemoClaw's skill at
`http://localhost:8000` and give it a journey prompt
("from Triton Square to Bank, I use a wheelchair").
