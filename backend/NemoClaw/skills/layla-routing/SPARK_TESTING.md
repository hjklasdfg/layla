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

### 2b. cuGraph GPU routing backend (TO BUILD — the only routing change)
RAPIDS on the Spark (use the CUDA-matching ARM build):

```bash
pip install --extra-index-url=https://pypi.nvidia.com cudf-cu12 cugraph-cu12
```

Keep **all** our fused edge weights — swap only the shortest-path step:
1. Build an edge list `(src, dst, weight)` from the same `_edge_record` fusion
   (steps / crime / noise / darkness) already in `route_engine.py`.
2. `cudf.DataFrame(edges)` → `cugraph.Graph` → `cugraph.sssp(G, source)` →
   trace the predecessor column back to the path.
3. Per profile/preference = a different `weight` column → recompute on GPU (ms).

Ingest, scoring, the 5 signals, and the server contract stay **identical** — only
`RE._dijkstra` is replaced by a `cugraph.sssp` call. Gate it behind a flag so the
CPU path stays the fallback:

```python
USE_GPU = os.environ.get("LAYLA_GPU") == "1"   # route_engine
```

### 2c. Test GPU vs CPU
```bash
# same OD on the all-London graph, time both:
LAYLA_GPU=0 python -c "import route_scoring as rs, time; t=time.time(); \
  rs.get_scored_routes('Triton Square','Greenwich','wheelchair'); print('CPU', time.time()-t)"
LAYLA_GPU=1 python -c "...same..."   # expect ms vs multi-second/timeout
```

---

## Nemotron / NemoClaw
The routing skill is the agent's **tool**. The local Nemotron (e.g. Nano 30B
NVFP4) running under NemoClaw calls `POST /mobility/plan` and narrates the result
(ElevenLabs TTS). To test the agent end-to-end, point NemoClaw's skill at
`http://localhost:8000` and give it a journey prompt
("from Triton Square to Bank, I use a wheelchair").
