# Hazard & Camera — Merge Scope

Use this doc when merging. It covers **only** the new work for:

1. **Live video hazard detection** (camera → YOLO backend)
2. **Hazard report process** (photo + GPS → council email draft)
3. **New backends** (`camera-hazard`, `layla-nemoclaw`)

Everything else in the branch (tourist landmarks, voice, mobility tweaks, NemoClaw submodule edits, `video/*.mov` test assets) is **out of scope** unless you explicitly want it in the same PR.

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                              │
├──────────────────────────────┬──────────────────────────────────────────┤
│  LIVE HAZARD WATCH           │  HAZARD REPORT (button in camera panel)  │
│  CameraPanel + useCameraStream│  HazardReportModal                       │
│       │ every ~300ms          │       │ one JPEG snapshot + GPS          │
│       ▼                      │       ▼                                  │
│  POST /api/camera/frame      │  POST /api/camera/report/stream (SSE)    │
│       │                      │       │                                  │
│       ├─ fake loop (local)   │       ├─ try layla-nemoclaw :8002        │
│       └─ proxy ──────────────┼───────┼─ fallback Nebius vision + web      │
└──────────────────────────────┼───────┼──────────────────────────────────┘
                               ▼       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BACKENDS                                        │
│  camera-hazard :8001          layla-nemoclaw :8002                      │
│  POST /camera/frame           POST /hazard/report/stream                │
│  YOLO proximity + voice       5 skills: VLM → geo → search → email      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Two separate services, two ports** — do not confuse them.

| Port | Service | Purpose |
|------|---------|---------|
| **8001** | `backend/camera-hazard` | Real-time frame analysis while walking |
| **8002** | `backend/layla-nemoclaw` | One-shot hazard **report** workflow |

---

## 1. Live video hazard detection

### What it does

- Browser camera captures JPEG frames (~300 ms interval).
- Frames go to Next.js `POST /api/camera/frame`.
- Either **fake loop** (no GPU) or **proxy** to `camera-hazard` YOLO service.
- Returns hazards, proximity, `action: stop|continue`, `voiceText` for TTS.
- `CameraPanel` shows live status and speaks warnings.

### New backend: `backend/camera-hazard/`

| File | Role |
|------|------|
| `server.py` | HTTP `:8001`, `GET /health`, `POST /camera/frame` |
| `frame_handler.py` | Decode JPEG, run detector |
| `yolo_worker.py` | Ultralytics YOLO inference |
| `road_hazard.py` | Proximity scoring, stop/crowded logic |
| `surroundings.py` | Position labels + voice text |
| `test_integration.py` | Smoke test against running server |
| `requirements.txt`, `Dockerfile`, `README.md` | Ops |
| `yolo11n.pt` | Weights (or auto-download) |

### New / changed frontend (live watch)

| Path | Role |
|------|------|
| `frontend/hooks/useCameraStream.ts` | Camera loop, frame upload, hazard state |
| `frontend/components/CameraPanel.tsx` | Live UI, record, **Report hazard** button |
| `frontend/lib/camera/hazard-stream.ts` | Types for frame API response |
| `frontend/lib/camera/hazard-fake-response.ts` | Fake bboxes for loop test |
| `frontend/lib/camera/hazard-server-launcher.ts` | Auto-start `camera-hazard` from Next.js |
| `frontend/lib/camera/surroundings.ts` | Client-side voice text helpers |
| `frontend/app/api/camera/frame/route.ts` | Frame ingress (fake or forward) |
| `frontend/app/api/camera/hazard/start/route.ts` | Warm up YOLO backend |

### Removed

| Path | Note |
|------|------|
| `frontend/app/api/camera/stream/route.ts` | Replaced by per-frame `/api/camera/frame` |

### Env vars (live watch)

```env
# Loop test — no YOLO backend needed
CAMERA_HAZARD_FAKE_LOOP=false          # true = fake bboxes only

# Real YOLO (your current .env.local)
CAMERA_HAZARD_API_URL=http://127.0.0.1:8001
CAMERA_HAZARD_AUTO_START=false
HAZARD_STOP_PROXIMITY_THRESHOLD=0.98

# Optional tuning
NEXT_PUBLIC_CAMERA_HAZARD_FRAME_MS=300
NEXT_PUBLIC_CAMERA_HAZARD_FRAME_WIDTH=640
YOLO_MODEL=yolo11n.pt
```

### How to test live watch

```bash
# Terminal 1 — YOLO backend
cd backend/camera-hazard
pip install -r requirements.txt
CAMERA_HAZARD_DEMO=1 python server.py    # or real YOLO without DEMO

# Terminal 2 — frontend
cd frontend && npm run dev
# Open app → start camera → watch hazard overlay / voice
```

With `CAMERA_HAZARD_FAKE_LOOP=true`, no Python backend required.

---

## 2. Hazard report process

### What it does

- User clicks **Report hazard** in `CameraPanel`.
- One **snapshot** (not the video loop) + **GPS** (or fallback landmark).
- Server runs an agentic pipeline and streams progress (SSE).
- UI shows **5 skill steps** + per-skill output cards + editable email.
- User can send via Resend or open mail app.

### Pipeline order

```
analyse_image (VLM)
  → resolve_location (Nominatim)
  → search_authority (DuckDuckGo, no API key)
  → prepare_content
  → prepare_email
```

**Primary:** `layla-nemoclaw` on `:8002`  
**Fallback:** Nebius vision + web search (`NEBUISAI_API_KEY`) if NemoClaw fails

### New backend: `backend/layla-nemoclaw/`

| Path | Role |
|------|------|
| `agent.py` | Orchestrates 5 skills, step/skill callbacks |
| `server.py` | `POST /hazard/report`, `POST /hazard/report/stream` (SSE) |
| `skills/analyse-image/` | Qwen VLM (or demo mode) |
| `skills/resolve-location/` | OSM Nominatim reverse geocode |
| `skills/search-authority/` | DuckDuckGo HTML search |
| `skills/prepare-content/` | Structured report facts |
| `skills/prepare-email/` | `to` / `subject` / `body` |
| `scripts/query.py` | CLI per skill |
| `test_agent.py` | Unit tests |
| `README.md`, `SKILL.md`, `requirements.txt` | Docs / deps |

### Data contract (frontend → Python)

`HazardReportModal` → `/api/camera/report/stream` → `hazard-nemoclaw-agent.ts` → Python:

```json
{
  "imageBase64": "<JPEG from canvas>",
  "mimeType": "image/jpeg",
  "lat": 51.53,
  "lng": -0.12,
  "userProfile": "general"
}
```

Python writes base64 to a **temp file**, runs VLM on that path, deletes after request.

GPS sources:

1. Browser geolocation → `CameraPanel` `gps` prop from `page.tsx`
2. Fallback: `HAZARD_REPORT_FALLBACK_LOCATION=st-pancras` → `lib/mobility/fallback-gps.ts`

### New / changed frontend (hazard report)

| Path | Role |
|------|------|
| `frontend/components/HazardReportModal.tsx` | SSE UI, 5 skill cards, email editor |
| `frontend/lib/camera/hazard-agent.ts` | Pipeline: NemoClaw first, Nebius fallback |
| `frontend/lib/camera/hazard-nemoclaw-agent.ts` | Client for `:8002` SSE |
| `frontend/lib/camera/layla-nemoclaw-launcher.ts` | Auto-start `layla-nemoclaw/server.py` |
| `frontend/lib/camera/hazard-nebius-agent.ts` | Nebius fallback agent |
| `frontend/lib/camera/types.ts` | `HazardSkillOutputs`, step IDs, stream events |
| `frontend/app/api/camera/report/stream/route.ts` | SSE to browser |
| `frontend/app/api/camera/report/route.ts` | Non-streaming JSON (legacy) |
| `frontend/app/api/camera/report/send/route.ts` | Send email (Resend / backend) |
| `frontend/lib/config/env.ts` | `laylaNemoclaw` + `cameraHazard` blocks |
| `frontend/lib/mobility/fallback-gps.ts` | Landmark GPS for reports without browser location |

### Env vars (hazard report)

```env
# NemoClaw (primary) — defaults: auto-start on, :8002
LAYLA_NEMOCLAW_DEMO=true                 # no GPU / no VLM weights
# LAYLA_NEMOCLAW_URL=http://127.0.0.1:8002
# LAYLA_NEMOCLAW_AUTO_START=true

# Nebius (fallback)
NEBUISAI_API_KEY=...
NEBUISAI_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct

# GPS fallback when browser location denied
HAZARD_REPORT_FALLBACK_LOCATION=st-pancras

# Optional email send
# RESEND_API_KEY=...
# HAZARD_REPORT_FROM_EMAIL=Layla <reports@yourdomain.com>
```

### How to test hazard report

```bash
# Terminal 1
cd backend/layla-nemoclaw
pip install -r requirements.txt
export LAYLA_NEMOCLAW_DEMO=1
python3 server.py

# Terminal 2
cd frontend && npm run dev
# Camera panel → Report hazard → watch 5 skills → review email
```

---

## 3. Shared frontend config

`frontend/lib/config/env.ts` adds two blocks:

- **`serverEnv.cameraHazard`** — live watch (`:8001`, fake loop, YOLO launcher)
- **`serverEnv.laylaNemoclaw`** — hazard report (`:8002`, demo mode, launcher)

`frontend/.env.local.example` documents both sections.

---

## 4. Test assets (optional in merge)

| Path | Note |
|------|------|
| `video/images.jpeg` | Still image for manual `agent.py` / VLM tests |
| `video/*.mov` | Demo / vision test clips — **not wired into app** by default |

Consider **not** merging large `.mov` files; keep `images.jpeg` if useful for docs.

---

## 5. Out of scope for this merge

Do **not** need to review these for hazard/camera unless you want one big PR:

- `frontend/components/TouristLandmarkPanel.tsx`, `lib/tourist/*`
- `backend/NemoClaw/skills/layla-routing/mobility_plan_server.py` (routing, not hazard)
- Voice / ElevenLabs / OpenClaw changes
- Root `README.md` unrelated edits

---

## 6. Merge checklist

### Backends

- [ ] `backend/camera-hazard/` — YOLO service, port **8001**
- [ ] `backend/layla-nemoclaw/` — 5-skill report agent, port **8002**
- [ ] Do **not** commit `backend/**/.venv/`, `__pycache__/`, or secrets in `.env.local`

### Frontend

- [ ] `frontend/components/CameraPanel.tsx`, `HazardReportModal.tsx`
- [ ] `frontend/hooks/useCameraStream.ts`
- [ ] `frontend/lib/camera/*` (hazard + launcher files)
- [ ] `frontend/app/api/camera/frame/`, `hazard/start/`, `report/**`
- [ ] `frontend/lib/config/env.ts`, `frontend/.env.local.example`
- [ ] Confirm `frontend/app/api/camera/stream/route.ts` **deleted** (replaced)

### Smoke tests before merge

```bash
# Live watch (fake)
CAMERA_HAZARD_FAKE_LOOP=true npm run dev   # in frontend/

# Live watch (YOLO)
cd backend/camera-hazard && CAMERA_HAZARD_DEMO=1 python server.py

# Hazard report
cd backend/layla-nemoclaw && LAYLA_NEMOCLAW_DEMO=1 python server.py
cd backend/layla-nemoclaw && LAYLA_NEMOCLAW_DEMO=1 python test_agent.py
```

### Production notes

| Concern | Recommendation |
|---------|----------------|
| GPU | YOLO on Spark/GPU host (`:8001`); VLM needs GPU or use `LAYLA_NEMOCLAW_DEMO` / Nebius fallback |
| Ports | 8001 = watch, 8002 = report — both can run on same machine |
| Secrets | `NEBUISAI_API_KEY`, `RESEND_API_KEY` server-only in `.env.local` |
| CORS | `camera-hazard` allows `*` on frame POST for dev |

---

## 7. Suggested PR title / summary

**Title:** `feat(camera): live YOLO hazard watch + NemoClaw hazard report pipeline`

**Summary bullets:**

- Add `camera-hazard` backend for real-time YOLO frame analysis (`:8001`)
- Add `layla-nemoclaw` 5-skill hazard report agent (`:8002`), NemoClaw-first with Nebius fallback
- Wire `CameraPanel` frame loop, fake-loop test mode, and `HazardReportModal` with SSE skill UI
- Replace monolithic camera stream route with `/api/camera/frame` + report `/api/camera/report/stream`
