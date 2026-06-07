---
title: "Hack for Impact London — Project Submission (Layla)"
date: 2026-06-07
status: draft
link: https://airtable.com/appcHdAhU9U1Eg6eo/pagqXe6ElIlXx6oa3/form
---

# Hack for Impact London: Project Submission — Layla

> Draft answers for the submission form. Polish and paste field-by-field.
> Status note: main contains the merged hazard + vision-stream + mobility core.
> **Several feature branches** carry additional work (cuGraph GPU routing on GB10,
> Ask-Layla NemoClaw agent loop, voice turn-by-turn navigation, scale benchmarks)
> — see "Feature branches" at the bottom for what to merge/cherry-pick before judging.

---

## Project Name *
**Layla — Voice-first Accessible Navigation on DGX Spark / HP Nano AI Station / Nebious Token Factory and ElevenLabs 11Agents**

## Team Name *
**Layla Team**

## Team Member Names & Email Addresses *
- Yilin Li — <yilinlee714@gmail.com>
- Ningqian Yang — <ningqian.y@gmail.com>
- Yao Gong - <gy960902@gmail.com>
- Charles Cai — <charles.cai@socialogix.net>
- Mark Xiaoyi Sun - <sxy.hj156@gmail.com>

## Submission Description *
Layla is a voice-first navigation assistant for people with special mobility needs (blind, wheelchair, elderly, night-safety personas). It listens, sees and reasons on-device on an **NVIDIA DGX Spark / HP Nano AI Station (GB10 Grace Blackwell)**, combining a multimodal LLM (**Nemotron-3-Nano-Omni-30B, NVFP4**) with live **Transport for London** data, 
**City of London** open data (OSM footways, accessibility points, crime, road noise, air quality, London Police crime incidences), a **YOLO** live-camera hazard watch, and an agentic crowdsourcing **Hazard Report Pipeline** (Nebious TokenFactory VLM → reverse-geocode → council search → email draft) packaged as **NVIDIA NemoClaw skills**. Voice in/out is handled by **ElevenLabs ElevenAgents** (**VAD, ASR, TTS** with custom LLM support).

What's new vs. a normal journey planner:
- **Re-routes per persona**, not re-ranks — different edge costs → different optimal path for blind / wheelchair / elderly / night-safety.
- **Three-layer accessibility**: TfL step-free (transit), OSM street features (kerbs/tactile/steps), and **live lift outages** that correct TfL's static step-free assumption.
- the recommended route is further enhanced with **Three more datasets**: **crime (London Police), noise (Defra), and air-quality (London Air Network) data** to help users make informed trade-offs, orchestrated by DGX Spark / HP Nano AI Station's ability to run all the reasoning and data-fetching / processing in one place.
- **On-device** multimodal inference (vLLM + NVFP4, ~32 GB VRAM, 128K context) — no cloud round-trip for the core planner. 
- **Agentic crowdsourcing hazard reporting** — one snapshot becomes a council-ready email through five composable NemoClaw skills, streamed back to the UI over SSE, the VLM is provided by Nebius TokenFactory, simulating a cloud VLM operated by public sectors - it's of the exact same architecture and inferencing endpoint as on device.

## Demo Video URL *
*(paste YouTube/Loom link before submission — ≤ 5 minutes)*

## Submission Track *

**2. Public Services** — 

Focus: Enhancing how people access and interact with city services and resources.

​The Goal: Use data to build tools that simplify navigation of public systems, making essential services more accessible, efficient, and user-friendly.


## GitHub Repo *
**https://github.com/hjklasdfg/layla**

Public. Main branch contains the merged demo. Feature branches listed at the bottom
of this document carry the GPU-routing and agent-loop extensions used in the demo.

## AI Models Used *
- **NVIDIA Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4** — multimodal
  (text + image), 128K context, optional thinking mode. Primary reasoning model
  for route planning, intent parsing, and "Ask Layla" Q&A. Served via **vLLM**
  on DGX Spark, OpenAI-compatible `/v1/chat/completions`.
- **Nemotron-3-Nano-Omni** via **Nebius AI TokenFactory** — cloud fallback for the same model
  when on-device is unavailable.
- **Qwen2.5-VL-72B-Instruct** (Nebius) — fallback VLM for hazard image analysis
  when the on-device VLM path is unavailable.
- **Ultralytics YOLO11n** — live per-frame hazard detection in the `camera-hazard`
  service (proximity-scored stop/continue signal, ~300 ms cadence).
- **ElevenLabs ElevenAgents Pipeline** — Conversational AI suite providing native end-to-end processing: Speech-to-Text (ASR) recognition, turn_v2 conversational turn-taking engine for rapid interruption handling, and ultra-low-latency Text-to-Speech (TTS) utilizing the eleven_flash_v2 voice model for spoken navigation adjustments. 

## Tools Used *
NVIDIA AI ecosystem tools, libraries, frameworks, SDKs, recipes:
- **NVIDIA DGX Spark / HP Nano AI Station** (GB10 Grace Blackwell, ARM64) — primary compute.
- **NVIDIA NemoClaw** — open-source agent-sandbox stack used to package and run
  Layla's skills. The repo ships skills under
  `backend/NemoClaw/skills/`:
  - `layla-data` — fused City-of-London open-data layer (OSM walkable graph
    with per-edge `length_m, highway, lit, is_steps, crime_count, noise_db,
    air_index`; live TfL lift outages, line status, road disruptions, station
    crowding).
  - `layla-routing` — persona-weighted path search over the fused graph
    (`general | blind | wheelchair | elderly | night_safety`), returning scored,
    map-ready candidates with a recommended route per persona.
  - `layla-nemoclaw` hazard-report pipeline (5 skills): `analyse-image`,
    `resolve-location`, `search-authority`, `prepare-content`, `prepare-email`.
- **Nemotron-3-Nano-Omni-30B (NVFP4)** — quantised multimodal Nemotron build,
  ~15 GB VRAM footprint on GB10.
- **vLLM Docker** (`vllm/vllm-openai:v0.20.0-aarch64-cu130`) — OpenAI-compatible serving
  on GB10, NVFP4 quant, 128K context.
- **NVIDIA cuGraph** (with **RMM** unified-memory pool on GB10) — optional GPU
  routing backend for the walkable graph; CPU Dijkstra fallback. Benchmarked
  vs. CPU on a tiled City-of-London OSM ingest.
- **NVIDIA NIM-compatible / OpenAI-compatible inference path** — same client
  code targets on-device vLLM, Nebius cloud, or a NemoClaw backend by switching
  `LLM_PROVIDER`.
- **NVIDIA GPU Accelerated Container Runtime** + **Docker** on Spark (`vllm-net` bridge for
  vLLM ↔ Caddy ↔ Open WebUI).
- **Open WebUI** — quick model-inspection UI on `vllm-net` for Nemotron3 Nano 30B Omini model vLLM endpoint evaluation.

- **ElevenLabs ElevenAgents SDK**, **Next.js 16 w Bun**, **TypeScript / Tailwind CSS 4**, **Leaflet + OpenStreetMap**, **Caddy Reverse Proxy - Let's Encrypt**, **Cloudflare Tunnel**,
- **Transport for London Unified API**
- **OSM / OpenStreet Map GeoJSON API**
- **Nominatim, DuckDuckGo, Resend**

## Nemotron Bounty eligibility
☑ **Check** — Nemotron-3-Nano-Omni-30B (NVFP4) is the primary on-device
reasoning + vision model: it ranks/explains routes, parses voice intent
("Ask Layla anything"), and powers the hazard-report skill chain.

## ElevenLabs Bounty eligibility
☑ **Check** — ElevenLabs **Scribe** for streaming STT and **ElevenLabs TTS**
for spoken route guidance and hazard warnings; ConvAI session tokens used for
low-latency turn-taking inside the camera panel.

---

# GB10 Experience

## Which GB10 platform capabilities were most valuable to your project and how? *

1. **Unified Grace-Blackwell memory + NVFP4 quant.** A 30B multimodal model
   (Nemotron-3-Nano-Omni) fits comfortably in **~15 GB** at NVFP4 with **128K
   context**. That made on-device, sub-second route reasoning realistic — no
   cloud hop, no PII leaving the device, voice latency dominated by ElevenLabs
   rather than the LLM.
2. **vLLM on aarch64 + CUDA 13.0.** The pre-built `vllm-openai:v0.20.0-aarch64-cu130`
   image gave us an OpenAI-compatible endpoint in minutes; our frontend's
   `LLM_PROVIDER` switch (`nemotron | nebius | backend`) targets the same wire
   format whether we're on Spark, in the cloud, or behind a NemoClaw agent.
3. **cuGraph + RMM unified-memory pool on GB10.** We swapped CPU Dijkstra for
   cuGraph SSSP on the fused walkable graph; the **shared CPU/GPU address space**
   on Grace-Blackwell let us hand NetworkX-built edges straight to cuGraph
   without an explicit host→device copy step.
4. **Headroom for parallel services.** vLLM (Nemotron), YOLO11n (camera-hazard),
   the NemoClaw hazard-report agent, Caddy, Open WebUI, and the Next.js dev server
   all coexist on a single Spark via the `vllm-net` Docker bridge — the box is the
   demo, not just the inference server.
5. **NVIDIA NemoClaw as the agent substrate.** Skill packaging (`layla-data`,
   `layla-routing`, hazard skills) gave us a clean seam between "data fetch" and
   "reasoning", so we can swap the planner for an agent-orchestrated tool call
   without touching the frontend contract.

## How likely are you to recommend the GB10 platform to other developers? (1–10) *
**9**

## Please share why or provide additional feedback. *
GB10 is the first machine where we could **run a 30B multimodal reasoning model
plus a vision pipeline plus a Next.js app plus a YOLO worker on the same host**
and still have headroom. The combination of (a) NVFP4 quantisation tooling, (b)
unified Grace-Blackwell memory removing a category of host↔device plumbing, and
(c) the pre-built aarch64 CUDA 13 vLLM image is a step-change vs. our prior
workstation rigs. We're knocking off one point because aarch64 wheel availability
is still patchy outside the NVIDIA-blessed images (PyTorch CUDA builds, some
Python deps), which made the first day of YOLO/cuGraph setup slower than it
needed to be — once over that hump, day-to-day dev was excellent.

## How would you rate your experience using local inference and compute on the GB10 platform compared to previous development environments? (1–10) *
**9**

## Please share why or provide additional feedback. *
- **Latency**: with Nemotron-3-Nano-Omni-30B at NVFP4, planning + ranking a TfL
  journey came back fast enough that ElevenLabs TTS, not the LLM, dominated the
  end-to-end "speak my route" path. That changes the UX design space.
- **Privacy**: voice transcripts, camera frames, and GPS never have to leave the
  Spark for the default path. For an accessibility tool, that's not a marketing
  point — it's a feature.
- **Iteration**: vLLM hot-reload + tmux + Cloudflare named tunnel = the laptop
  is the dev experience, but the Spark is the runtime. We did all UI work on
  MacBook against the live Spark over Tailscale/Cloudflare with no penalty.
- **Compared to prior cloud-only flows**: no per-token cost meant we could leave
  the agent loop running during hacking — "Ask Layla" went from a measured
  feature to something we just left chatting at the model all day.
- **One soft spot**: when a model with thinking enabled gets a ~10 seconds ElevenLabs
  ConvAI turn budget, you very quickly learn to switch `enable_thinking: false`
  for the spoken path. The elevenlabs convAI shows error timeout with reasoning enabled. That's a UX-design lesson, not a platform fault.

## What additional features or improvements would have made the GB10 platform more effective for your project?
- **Broader prebuilt aarch64 wheels** (PyTorch CUDA, ultralytics, cuGraph) — or
  an "AI starter" container that bundles vLLM + cuGraph + RAPIDS + YOLO on
  aarch64-cu130. We spent meaningful time on first-day deps.
- **First-class NVFP4 model index for Nemotron family** — a one-line pull for
  "the right NVFP4 build for this Spark" would have saved us a setup script.
- **More memory headroom signalling** in `nvidia-smi` / dcgm for **Grace unified
  memory** specifically — VRAM-fraction tuning (`--gpu-memory-utilization`) was
  iterative; we crashed once at 0.5 (see `docs/crash-reports/`), settled at 0.40.
- **vLLM `--enable-prefix-caching` tuned for multimodal** — image-prompt prefix
  caching would shave more off the hazard-report path where the system prompt
  is large and stable across calls.
- **Built-in NemoClaw skill registry browsing on the device** — a `nemoclaw
  skills list` that surfaces both shipped and user-authored skills (we currently
  rely on directory layout).
- **An "agent loop" reference recipe for Nemotron + tool calling on vLLM** —
  we built one (see `eab15c9` on the `rocky` branch) but a starter would help
  the next hackathon team move faster.

---

## Feature branches (judge note)
Main has the merged demo. Additional production-ready work lives in branches:

| Branch | What's in it |
|---|---|
| `rocky` | NemoClaw agent loop ("Ask Layla via Nemotron with `layla-data` tools"), demo nav mode, GPS dot animation, voice-question intent fix, cuGraph SSSP routing + RMM managed memory on GB10, central-London corridor expansion, scale benchmark (CPU Dijkstra vs cuGraph). |
| `voice-navigation` | Valhalla turn-by-turn + GPS + TTS; ElevenLabs direct-model low-latency backend with thinking disabled for voice. |
| `yg/add-nebius-agentic-harzard-report` | Original Nebius agentic hazard pipeline (merged variant on main; richer flow on branch). |
| `yg/vision-stream` (merged) | Live `camera-hazard` YOLO pipeline + `layla-nemoclaw` 5-skill report pipeline. |
| `backend/nemoclaw-dev` | NemoClaw skills under `backend/NemoClaw/skills/` (the `layla-data` + `layla-routing` skills referenced above). |

Recommended pre-judging merge order: `backend/nemoclaw-dev` → `rocky` →
`voice-navigation` (cherry-pick the low-latency voice commit).
