# Layla Voice Integration — How It Works

> Continuous voice for Layla, the London accessibility/mobility guide, via
> **ElevenLabs Conversational AI** talking to a **self-hosted OpenAI-compatible
> Custom LLM** that streams from a local Nemotron model on the DGX Spark.
>
> Status: **working end-to-end** (verified 2026-06-06). First spoken token ≈1s.

---

## 1. The big picture

ElevenLabs runs the voice loop (mic → speech-to-text → **our LLM** → text-to-speech
→ speaker). It does *not* run the language model — instead it calls **our**
OpenAI-compatible `/chat/completions` endpoint as a "Custom LLM". That endpoint
lives in the Next.js frontend app and streams tokens from a local Nemotron model
served on the DGX Spark. Everything but ElevenLabs runs on one host.

```
  ┌─────────────┐  mic/STT    ┌────────────────────┐
  │  Browser /  │────────────▶│   ElevenLabs        │
  │  phone      │◀────────────│   Conversational AI │   (cloud: ASR + turn-taking + TTS)
  └─────────────┘  TTS audio  └─────────┬──────────┘
                                         │  POST /chat/completions
                                         │  (OpenAI chat-completions, stream=true,
                                         │   Authorization: Bearer <secret>)
                                         ▼
                              ┌────────────────────────┐
                              │ Cloudflare edge         │
                              │ layla-dev.ai-cloud.io   │
                              └─────────┬──────────────┘
                                         │  (named tunnel, QUIC)
                                         ▼
                              ┌────────────────────────┐
                              │ cloudflared (DGX Spark) │  ingress: layla-dev → :3002
                              └─────────┬──────────────┘
                                         ▼
                ┌──────────────────────────────────────────────┐
                │ Next.js app on :3002  (the "Custom LLM")       │
                │   POST /chat/completions                       │
                │   = handleVoiceChat()                          │
                │     1. Bearer auth                             │
                │     2. parse OpenAI messages                   │
                │     3. build persona + history                 │
                │     4. stream from model, strip "thinking"     │
                │     5. re-emit as OpenAI SSE + map tool-calls   │
                └─────────────────────┬────────────────────────┘
                                       │  POST /v1/chat/completions (stream=true,
                                       │  chat_template_kwargs.enable_thinking=false)
                                       ▼
                          ┌─────────────────────────────┐
                          │ llama-server on :8000        │
                          │ Nemotron-3-Nano-Omni-30B     │
                          │ (reasoning build)            │
                          └─────────────────────────────┘
```

There is a second, slower backend (`VOICE_BACKEND=openclaw`) that routes through
the OpenClaw/NemoClaw agent gateway for tool use and memory. It is **not** used
for the live voice loop because the agent loop exceeds ElevenLabs' timeout; see
§6.

---

## 2. Request lifecycle (one spoken turn)

1. User speaks. ElevenLabs transcribes (ASR `pcm_16000`, `turn_v2`).
2. On end-of-turn, ElevenLabs POSTs an **OpenAI chat-completions** request to
   `https://layla-dev.ai-cloud.io/chat/completions` with:
   - `Authorization: Bearer <VOICE_CHAT_SECRET>`
   - `stream: true`, `model: "nemoclaw"` (the model id is **ignored** by us — we
     always use the configured local model)
   - `messages`: an ElevenLabs-injected system prompt, the agent's
     `first_message`, then the conversation so far (user/assistant turns).
3. `handleVoiceChat()` (`frontend/lib/voice/handle-voice-chat.ts`):
   - **Auth** — constant-time Bearer check. Missing/wrong → `401`.
   - **Parse** — bad JSON → `400`; no user text → `400`.
   - **Build messages** — prepends our own `VOICE_SYSTEM_PROMPT` (the Layla voice
     persona) and any current map/route context, then appends the user/assistant
     history. The ElevenLabs system message is dropped in favour of our persona.
   - **Stream** — opens a `ReadableStream` and immediately sends the OpenAI
     `role` frame, then streams content as it arrives.
4. `streamModelReply()` (`frontend/lib/voice/model-stream.ts`) POSTs to
   `http://127.0.0.1:8000/v1/chat/completions` with `stream:true` and
   **`chat_template_kwargs:{enable_thinking:false}`** (the critical latency fix,
   §3). It forwards **only `delta.content`** to the caller and discards
   `delta.reasoning` / `delta.reasoning_content` so the model's chain-of-thought
   is never spoken.
5. As content arrives, a `MarkerStreamParser` splits out any inline map commands
   (`[[MAPCMD{...}MAPCMD]]`): spoken text becomes OpenAI `content` deltas; map
   commands become OpenAI `tool_calls` for ElevenLabs client tools. ElevenLabs
   speaks the content via TTS (`eleven_flash_v2`) the moment tokens arrive.
6. On completion we send the `finish` frames + `[DONE]`.

---

## 3. The critical fix: disable "thinking" on the voice path

**Symptom.** In the ElevenLabs console the agent appeared unable to reach the
LLM — conversations stalled with no spoken reply.

**What was really happening.** The requests *were* arriving and authenticating
fine. The model on `:8000` is the **Reasoning** Nemotron build (started with
`--reasoning-format deepseek`), so it *thinks before it speaks*. On a non-trivial
turn the think phase ran **>12s**, emitting only `reasoning_content` (which we
correctly strip) and **zero spoken `content`**. ElevenLabs hit its turn/cascade
timeout (~12–15s) and cancelled the stream itself (HTTP/2 `error code 0`). The
user heard nothing, so it looked like "can't reach the endpoint."

Diagnostic line that nailed it (with `VOICE_DEBUG=1`):

```
[voice/debug] ABORT after 12389ms firstContent=-1ms sentChars=0
```

`firstContent=-1` / `sentChars=0` = the model never produced a spoken token
before ElevenLabs gave up.

**Fix.** Send `chat_template_kwargs:{enable_thinking:false}` in the request body
to `:8000`. This skips the think phase, so the first spoken token arrives in ~1s.

**Why that specific knob.** Measured against `:8000` with the messy query
*"Who's got V1? Where did you write it?"*:

| Request knob | First spoken token | Still thinks? |
|---|---|---|
| baseline (thinking on) | ~5.2s | yes |
| `reasoning_effort: "none"` | ~10.0s | **yes — silently ignored** |
| `reasoning_budget: 0` | ~5.7s | **yes — silently ignored** |
| **`chat_template_kwargs.enable_thinking=false`** | **~1.0s** | **no** ✅ |

On this llama-server build only `chat_template_kwargs.enable_thinking=false`
actually disables reasoning; `reasoning_effort` and `reasoning_budget` are
accepted but ignored. The setting is harmless to non-reasoning backends, which
ignore unknown template kwargs.

**Trade-off.** A voice guide that answers in two spoken sentences needs
first-token-fast far more than it needs a visible chain of thought, so disabling
thinking on the voice path is the correct call. The slower agent backend (with
tools + memory) remains available off the voice loop.

---

## 4. Measured latency (verified 2026-06-06)

End-to-end through the public tunnel, after the fix:

| Turn | First spoken token | Full 2-sentence reply |
|---|---|---|
| Simple greeting ("who are you?") | ~0.4s | ~1.5s |
| Messy / non-trivial transcript | ~0.4s | ~1.5s |

Before the fix the same non-trivial turn produced **0 spoken tokens in 12.4s**
→ ElevenLabs abort. All comfortably under the agent's `cascade_timeout` (15s, the
platform max) and `turn_timeout` (30s).

---

## 5. Configuration reference

### Frontend `.env.local` (gitignored — never commit secrets)

| Var | Value (this deployment) | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VOICE_MODE` | `conversational` | Use ElevenLabs ConvAI (vs. legacy push-to-talk Scribe) |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | `agent_01jyey0kx9fzarbk5z0bw2vpmv` | The ConvAI agent |
| `VOICE_CHAT_SECRET` | `your-demo-secret` | Bearer secret; **must match** the agent's Custom-LLM API key value |
| `VOICE_BACKEND` | `model` | `model` = direct/low-latency; `openclaw` = agent loop |
| `VOICE_MODEL_URL` | `http://127.0.0.1:8000/v1` | Local OpenAI-compatible model |
| `VOICE_MODEL` | `nvidia/Nemotron-3-Nano-Omni-30B` | Model id sent to `:8000` |
| `VOICE_MODEL_MAX_TOKENS` | `1024` | Cap (1024 is the reliable sweet spot) |
| `VOICE_DEBUG` | `1` (temporary) | Logs incoming requests + abort timing to the server log |

### ElevenLabs agent (Custom LLM)

- **URL:** `https://layla-dev.ai-cloud.io` (ElevenLabs appends `/chat/completions`)
- **model_id:** `nemoclaw` (cosmetic — ignored by our endpoint)
- **api_type:** `chat_completions`
- **api_key:** secret whose value equals `VOICE_CHAT_SECRET`
- **cascade_timeout_seconds:** `15` (platform hard max), **turn_timeout:** `30`

### Cloudflare tunnel ingress (`scripts/cloudflare/cloudflared.yml`)

```yaml
ingress:
  - hostname: layla.ai-cloud.io        # main app
    service: http://localhost:80
  - hostname: layla-dev.ai-cloud.io    # voice build — the Custom LLM
    service: http://localhost:3002
  - hostname: "*.ai-cloud.io"
    service: http://localhost:80
  - service: http_status:404
```

> cloudflared does **not** hot-reload on `SIGHUP` (it exits). To apply an ingress
> change, restart the process; it re-reads the config on start and the tunnel
> reconnects within a few seconds.

### Inference processes on the DGX Spark

| Port | Process | Notes |
|---|---|---|
| `:8000` | `llama-server` — Nemotron-3-Nano-Omni-30B (reasoning GGUF, Q8) | **voice model**; `--reasoning-format deepseek` |
| `:18000` | vLLM — Nemotron reasoning NVFP4 | other workloads |
| `:18789` | OpenClaw/NemoClaw gateway (WS RPC) | used only by `VOICE_BACKEND=openclaw` |
| `:3000` | main Layla app | unaffected by the voice build |
| `:3002` | voice build (the Custom LLM endpoint) | served by `next start -p 3002` |

---

## 6. Why not route voice through the NemoClaw agent?

`VOICE_BACKEND=openclaw` bridges ElevenLabs to the agent gateway (WS RPC) so the
voice turn can use tools and persistent memory. It works, but the agentic loop
(planning + tool calls + multi-cycle reasoning) routinely takes 20–30s to first
spoken token — well past ElevenLabs' 15s cascade timeout — so the live voice loop
uses the **direct model** backend instead. The agent path is retained for
non-realtime use and future work (e.g. a "remember my mobility needs" action that
can tolerate latency, or a barge-in design that speaks a quick holding reply while
the agent works).

---

## 7. Operating & troubleshooting

**Start the voice build:**
```bash
cd /home/nvidia/layla/frontend
npm run build
VOICE_DEBUG=1 setsid nohup npx next start -p 3002 > /tmp/layla-voice-3002.log 2>&1 < /dev/null & disown
```

**Health checks:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/chat/completions      # 405 = route present (POST-only)
curl -s -o /dev/null -w "%{http_code}\n" https://layla-dev.ai-cloud.io/chat/completions  # 405 = tunnel OK
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/v1/models               # 200 = model up
```

**Simulate an ElevenLabs request:**
```bash
curl -sN -X POST https://layla-dev.ai-cloud.io/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-demo-secret" \
  -d '{"model":"nemoclaw","stream":true,"messages":[{"role":"user","content":"Hi, who are you?"}]}'
```

**Read the diagnostics** (`tail -f /tmp/layla-voice-3002.log` with `VOICE_DEBUG=1`):

| Log line | Meaning |
|---|---|
| `[voice/debug] IN auth=true ...` | Request arrived and authenticated |
| `[voice/debug] IN auth=false ...` | Bearer missing/wrong → would 401 (check `VOICE_CHAT_SECRET` ↔ agent secret) |
| `ABORT ... firstContent=NNms sentChars=>0` | Normal — ElevenLabs cut over to next turn after we spoke |
| `ABORT ... firstContent=-1ms sentChars=0` | **Bad** — model produced no speech before timeout (thinking not disabled?) |

| Symptom | Likely cause | Fix |
|---|---|---|
| Console "can't reach", no audio | model thinking too long, no spoken token before abort | ensure `chat_template_kwargs.enable_thinking=false` is sent (§3) |
| `401` on every request | secret mismatch | align `VOICE_CHAT_SECRET` with the agent's Custom-LLM api key |
| Public URL returns `404` | tunnel hitting the wrong app (`:3000`) | restart cloudflared so `layla-dev → :3002` |
| Public URL returns `521`/`502` | origin down or tunnel mid-reconnect | confirm `:3002` is up; wait for tunnel to settle / restart it |
| GET returns `405` | **correct** — the route is POST-only | none |

---

## 8. Source map (frontend)

| File | Role |
|---|---|
| `app/chat/completions/route.ts` | Public Custom-LLM endpoint (ElevenLabs hits this) |
| `app/api/voice/chat/route.ts` | Same handler, internal mount |
| `lib/voice/handle-voice-chat.ts` | Auth, message building, SSE streaming, debug logging |
| `lib/voice/model-stream.ts` | Streams from `:8000`; **disables thinking**; strips reasoning |
| `lib/voice/openclaw-client.ts` | Alternate agent-gateway backend (WS RPC) |
| `lib/voice/marker-stream.ts` | Split-safe `[[MAPCMD…]]` parser |
| `lib/voice/openai-sse.ts` | OpenAI SSE frame builders (role/content/tool_call/finish/error) |
| `lib/voice/openclaw-content.ts` | Speakable-text extraction / increment math |
| `lib/voice/voice-chat-helpers.ts` | Bearer check, session resolution, content flattening |
| `lib/voice/route-store.ts` | In-memory current-route/map context per session |
| `lib/config/env.ts` | `serverEnv.voice` / `serverEnv.openclaw` / `publicEnv.voiceMode` |
| `components/VoiceConversationPanel.tsx` | Browser `useConversation` + map client tools |

See also: `frontend/docs/voice-conversational-ai-setup.md` (setup runbook).
