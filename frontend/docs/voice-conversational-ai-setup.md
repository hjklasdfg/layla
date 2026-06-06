# Conversational AI Voice — Setup & Status

Continuous voice through ElevenLabs Conversational AI → `/api/voice/chat` adapter →
OpenClaw agent (Nemotron) on this DGX. Built per the 2026-06-06 eng review.

```
Browser ⇄ WSS ⇄ ElevenLabs ConvAI ──Custom-LLM POST /api/voice/chat──▶ Next.js (DGX)
                                                  │ ws://127.0.0.1:18789/ws (chat.send)
                                                  ▼
                                        OpenClaw agent ──▶ Nemotron (vLLM :18000)
```

## What is built and verified ✅

- **`/api/voice/chat`** — OpenAI-compatible streaming endpoint (Node runtime). Bearer
  auth, latest-user-turn only, route-context injection, marker→tool_call, reasoning
  stripped, barge-in via request abort. Verified end-to-end against the live gateway.
- **`lib/voice/openclaw-client.ts`** — gateway WS RPC client (connect/chat.send/stream,
  settle-debounce end-of-turn, runId correlation). Verified live.
- **`lib/voice/{marker-stream,openclaw-content,openai-sse,voice-chat-helpers,route-store}.ts`**
  — pure core, 40 unit tests incl. marker-split-across-chunks.
- **`components/VoiceConversationPanel.tsx`** — `useConversation` + client tools
  (`show_routes`/`highlight_route`/`show_hazard`), behind `NEXT_PUBLIC_VOICE_MODE`.
- App builds; existing Scribe path untouched (default).

Run tests: `npm test`. Live adapter test: `OPENCLAW_LIVE=1 OPENCLAW_GATEWAY_TOKEN=$(jq -r .gateway.auth.token ~/.openclaw/openclaw.json) npx vitest run lib/voice/openclaw-client.integration.test.ts`

## To turn it on (external steps — required) ⚠️

1. **Create an ElevenLabs Conversational AI agent** (dashboard):
   - LLM → **Custom LLM**, URL = `https://<your-tunnel-host>/api/voice/chat`
   - Custom-LLM secret = the value of `VOICE_CHAT_SECRET` (sent as `Authorization: Bearer`)
   - System prompt: leave blank (the agent persona lives in OpenClaw `soul.md`)
   - Register **client tools** named exactly `show_routes`, `highlight_route`,
     `show_hazard` with the params used in `VoiceConversationPanel.tsx`.
   - Copy the **Agent ID**.
2. **Expose the app** via the Cloudflare tunnel (quick tunnel for now) and put the
   public host in the agent's Custom-LLM URL.
3. **Set env** in `.env.local`: `NEXT_PUBLIC_VOICE_MODE=conversational`,
   `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<agent id>`, `VOICE_CHAT_SECRET=<strong secret>`,
   `OPENCLAW_GATEWAY_TOKEN` (already set from `~/.openclaw/openclaw.json`).
4. Restart `next start`.

## Known blockers / follow-ups (from the review + live testing)

- **OpenClaw agent is NOT voice-tuned yet (biggest blocker for good UX).** Live tests
  showed the agent taking 30s+ to first token and attempting sandbox tools (`edit`) on
  trivial prompts. For usable voice it needs a voice persona in `soul.md`
  (≤2 sentences, spoken-only, no filler) and its coding/file tools disabled for the
  voice session. Until then latency and tangents make continuous voice rough.
- **tool_call → client-tool firing is unproven** against ElevenLabs. Spike a fake
  Custom-LLM that returns a tool_call and confirm ElevenLabs invokes the browser tool
  before relying on map updates (Codex #1/#20).
- **Marker → route-ID hardening (TODO).** The agent emits `[[MAPCMD{json}MAPCMD]]`
  markers; harden to a validated route-ID tool later (injection/collision risk).
- **route-store is not yet written by `/api/mobility/plan`.** Until wired, route
  context injects as "No active route" and the agent asks for the destination. Wire
  `/api/mobility/plan` to `setRouteContext(sessionId, …)` keyed by the same session id.
- **Named Cloudflare tunnel (TODO)** — quick tunnel host changes on restart and breaks
  the ElevenLabs URL + user links.
- **Persona/marker-discipline evals (TODO)** — deferred; manual checklist for now.
- **Audio arbitration** — GPS-guidance TTS (`/api/voice/speak`) and ConvAI audio can
  overlap; arbitrate before shipping GPS turn-by-turn.
