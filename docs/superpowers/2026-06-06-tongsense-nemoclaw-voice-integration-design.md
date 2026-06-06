# TongSense × NemoClaw × ElevenLabs Voice Integration — Design Spec

**Date:** 2026-06-06  
**Status:** Approved — ready for implementation  
**Author:** Brainstorming session (Claude Code)  
**Target projects:** `/home/mark/TongSense` (modified), `/home/mark/NemoClaw` (used as-is)

---

## Table of Contents

1. [Background & Context](#1-background--context)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [System Overview](#3-system-overview)
4. [Project Structure: What Exists Today](#4-project-structure-what-exists-today)
5. [Architecture: Approach A](#5-architecture-approach-a)
6. [Full Data Flow](#6-full-data-flow)
7. [Backend: `/api/voice/chat`](#7-backend-apichat)
8. [Memory System](#8-memory-system)
9. [Context Builder](#9-context-builder)
10. [NemoClaw Inference Provider](#10-nemoclaw-inference-provider)
11. [Frontend: VoicePanel Component](#11-frontend-voicepanel-component)
12. [Frontend: VoiceRouteContext Bridge](#12-frontend-voiceroutecontext-bridge)
13. [Frontend: RouteMap Integration](#13-frontend-routemap-integration)
14. [ElevenLabs Agent Configuration](#14-elevenlabs-agent-configuration)
15. [Environment Variables](#15-environment-variables)
16. [Security](#16-security)
17. [Error Handling & Degradation](#17-error-handling--degradation)
18. [File Manifest: New Files](#18-file-manifest-new-files)
19. [File Manifest: Modified Files](#19-file-manifest-modified-files)
20. [Testing Strategy](#20-testing-strategy)
21. [Out of Scope](#21-out-of-scope)
22. [Future Extension Points](#22-future-extension-points)
23. [Glossary](#23-glossary)

---

## 1. Background & Context

### What is TongSense?

TongSense is an accessibility-aware mobility intelligence platform for urban journey planning, currently targeting London (TfL — Transport for London). It helps users with different mobility needs (wheelchair users, visually impaired, elderly, etc.) find optimal routes by combining:

- **Real-time TfL transit data** — bus, tube, overground routes
- **OpenStreetMap accessibility infrastructure** — wheelchair access, tactile paving, crossings, steps
- **Computer vision crowd sensing** — crowding risk, obstacle detection (simulated, CV pipeline planned)
- **AI-powered mobility agent** — currently Gemini 2.0-flash, being replaced with NemoClaw for the voice path

Routes are scored by "mobility signals": accessibility, stress, reliability, predictability, crowding risk, crossing complexity. Scores are weighted by a user profile (wheelchair/blind/elderly/general/custom) and a priority (fastest/least_stressful/most_accessible/most_reliable).

**Current tech stack:**
- Framework: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- Maps: Leaflet + react-leaflet (OpenStreetMap tiles)
- LLM: Gemini 2.0-flash via REST API (`/api/agent/recommend`)
- Backend: Next.js API routes only (no separate server)
- Voice: **none** — text-only today
- Channels: **none** — web UI only

### What is NemoClaw?

NemoClaw (`/home/mark/NemoClaw`) is an open-source reference stack from NVIDIA for running always-on AI agents (OpenClaw, Hermes) inside OpenShell sandboxes. It provides:

- CLI tooling to provision/manage OpenShell sandbox containers
- Blueprint for sandbox orchestration (plan/apply/status/rollback FSM)
- Security hardening (network policies, credential sanitization, SSRF validation)
- An OpenClaw plugin system with `before_tool_call` and `before_prompt_build` hooks

**For this integration, NemoClaw is used only as an inference endpoint.** After `nemoclaw onboard` is run, NemoClaw exposes an OpenAI-compatible inference API inside its sandbox, accessible via port-forward at `http://localhost:18789/v1`. TongSense calls this endpoint directly. No changes are made to the NemoClaw codebase.

### What is ElevenLabs Conversational AI?

ElevenLabs offers a hosted Conversational AI platform that handles the full voice loop in one WebSocket session:
- **VAD** (Voice Activity Detection) — detects when the user starts/stops speaking
- **STT** (Speech-to-Text) — transcribes user audio in real time
- **LLM** — calls a configurable LLM backend (in our case, TongSense's `/api/voice/chat`)
- **TTS** (Text-to-Speech) — speaks the LLM response back to the user

The browser uses the ElevenLabs JS SDK (`@11labs/react`) to open a WebSocket to ElevenLabs cloud. ElevenLabs then calls our custom LLM endpoint (TongSense) on each turn. TongSense proxies to NemoClaw inference.

---

## 2. Goals & Non-Goals

### Goals

- **Replace Gemini with NemoClaw** as the LLM backend for the voice interaction path in TongSense
- **Add real-time voice interaction** as the primary interaction modality: user speaks → agent responds via TTS
- **Persistent user memory** via `memory.md`: facts learned about the user (accessibility needs, preferences, frequent destinations) are stored and re-injected as context on every turn — the agent never re-asks known facts
- **Map updates via voice**: when the agent finds routes, the Leaflet map updates in real time without page reload
- **Voice panel UI**: embedded in the existing TongSense sidebar alongside the map, replacing the static `MobilityAgentPanel`
- **Non-breaking**: the existing text-based form + Gemini `/api/agent/recommend` endpoint stays untouched as a fallback

### Non-Goals (this phase)

- Video/image stream ingestion and computer vision analysis (hook point is designed in, but not implemented)
- Multi-user production auth (session isolation by cookie/session ID is sufficient for now)
- Memory encryption at rest
- ElevenLabs CLI runtime integration (CLI is only for local dev testing of the ElevenLabs agent config)
- Changes to the NemoClaw codebase
- Replacing the text-based Gemini path (it stays as-is)

---

## 3. System Overview

Three external systems interact:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BROWSER (TongSense Next.js frontend)                                   │
│                                                                         │
│  ┌──────────────────┐   ┌──────────────────────────────────────────┐   │
│  │   RouteMap       │   │  VoicePanel (NEW)                        │   │
│  │  (existing       │◄──│  - ElevenLabs JS SDK (WebSocket)         │   │
│  │   Leaflet map)   │   │  - VAD handled by ElevenLabs cloud       │   │
│  │                  │   │  - Mic button, transcript, agent status  │   │
│  │  route updates ◄─┤   │  - Fires map commands → VoiceRouteCtx   │   │
│  └──────────────────┘   └──────────────────────────────────────────┘   │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │ WebSocket (audio + text events)
                              ┌─────────▼──────────┐
                              │  ElevenLabs Cloud   │
                              │  STT / VAD / TTS    │
                              │  Turn management    │
                              └─────────┬──────────┘
                                        │ POST /api/voice/chat
                                        │ (OpenAI chat completions, streaming)
                              ┌─────────▼──────────────────────────────┐
                              │  TongSense Next.js backend  (NEW)      │
                              │  /api/voice/chat/route.ts              │
                              │                                         │
                              │  1. Verify ElevenLabs signature        │
                              │  2. Load memory.md (user facts)        │
                              │  3. Load current route context         │
                              │  4. Build enriched system prompt       │
                              │  5. Stream to NemoClaw inference       │
                              │  6. Pipe SSE stream back               │
                              │  7. Post-turn: extract + save facts    │
                              └─────────┬──────────────────────────────┘
                                        │ OpenAI-compat HTTP (streaming SSE)
                              ┌─────────▼──────────┐
                              │  NemoClaw sandbox   │
                              │  http://localhost:  │
                              │  18789/v1           │
                              │  (port-forwarded)   │
                              └────────────────────┘
```

---

## 4. Project Structure: What Exists Today

### TongSense key files (relevant to this integration)

```
/home/mark/TongSense/
├── app/
│   ├── page.tsx                        # Main UI — 2-col layout, client component
│   └── api/
│       ├── agent/recommend/route.ts    # Existing Gemini text path — DO NOT MODIFY
│       └── routes/route.ts             # TfL route search — used by voice context builder
├── components/
│   ├── RouteMap.tsx                    # Leaflet map — will be extended to watch VoiceRouteContext
│   └── MobilityAgentPanel.tsx         # Will be replaced/supplemented by VoicePanel in the sidebar
├── lib/
│   ├── agent/providers/
│   │   ├── gemini.ts                   # Gemini provider — reference for nemoclaw.ts structure
│   │   └── types.ts                    # AgentProvider interface to implement
│   ├── config/env.ts                   # Env loader — extend with NemoClaw + ElevenLabs vars
│   └── mobilityEngine.ts              # buildMobilityRoutes() — called by context builder
├── hooks/
│   └── useLiveRoutes.ts               # Route state hook — extend to accept VoiceRouteContext commands
└── .env.local.example                 # Add new vars here
```

### NemoClaw key files (read-only reference — do not modify)

```
/home/mark/NemoClaw/
├── nemoclaw/src/index.ts               # Plugin entry — shows OpenAI-compat provider registration
├── src/lib/inference/config.ts         # Inference provider config — shows endpoint/credential shape
└── agents/openclaw/manifest.yaml       # Shows default port (18789) and gateway_command
```

NemoClaw exposes its inference endpoint after running:
```bash
nemoclaw onboard          # configure inference provider + model
nemoclaw <sandbox> start  # boot sandbox
```
The sandbox inference endpoint is then accessible at `http://localhost:18789/v1` (port-forwarded).

---

## 5. Architecture: Approach A

**Chosen approach**: TongSense backend owns context assembly and acts as the ElevenLabs custom LLM adapter. NemoClaw is a pure inference engine.

**Why this approach:**
- TongSense already owns routes, scores, TfL data, OSM data — context must be assembled where the data lives
- NemoClaw sandbox is an isolated container — it cannot reach out to TongSense APIs without policy changes
- Video/image stream context (future) also lives in TongSense — same enrichment layer will handle it
- No new services: one Next.js backend, one NemoClaw sandbox
- NemoClaw needs zero code changes — it is used exactly as designed

**Rejected approaches:**
- Dedicated voice microservice: adds operational complexity and shared-state problem without benefit
- NemoClaw plugin owns everything: fights both projects' architecture; NemoClaw sandbox can't easily reach TongSense data

---

## 6. Full Data Flow

### Per-turn sequence (voice)

```
1. User speaks into microphone (browser)
        │
        ▼ (audio stream via WebSocket)
2. ElevenLabs Cloud
   - VAD detects end of utterance
   - STT transcribes audio → text
   - Appends to conversation messages[]
        │
        ▼ POST /api/voice/chat
          Body: { model, messages, stream: true }
          Header: ElevenLabs-Signature: <hmac>
3. TongSense /api/voice/chat handler
   a. Verify HMAC signature (lib/voice/auth.ts)
   b. Extract sessionId from request (cookie or header)
   c. loadMemory(sessionId)    → read data/voice/memory-{sessionId}.md
   d. getCurrentRouteContext() → read in-memory RouteStore (populated by /api/routes calls)
   e. buildSystemPrompt(memory, routeContext) → assemble full system message (lib/voice/context-builder.ts)
   f. Prepend system message to messages[]
   g. POST to NemoClaw: http://{NEMOCLAW_INFERENCE_URL}/chat/completions
      Headers: Authorization: Bearer {NEMOCLAW_API_KEY}
      Body: { model: NEMOCLAW_MODEL, messages, stream: true }
        │
        ▼ (SSE stream)
4. NemoClaw inference endpoint
   - Runs configured LLM (Nemotron or other)
   - Streams tokens back as SSE
        │
        ▼ (piped through TongSense)
5. TongSense pipes SSE stream directly to ElevenLabs response
   - No buffering on the happy path
   - Accumulates full response text in background for step 6
        │
        ▼ (text events)
6. ElevenLabs Cloud
   - Receives streamed text tokens
   - TTS: synthesises speech in real time
   - Streams audio back to browser WebSocket
        │
        ▼ (audio stream)
7. Browser VoicePanel
   - ElevenLabs SDK plays audio via Web Audio API
   - onMessage callback receives full assistant message text
   - VoicePanel parses for map_command JSON blocks
   - If map_command found: fires into VoiceRouteContext
        │
        ▼ (React context update)
8. RouteMap
   - Watches VoiceRouteContext for pendingCommand
   - Calls /api/routes with new from/to
   - Updates Leaflet map overlays

9. Post-turn (async, after stream ends):
   TongSense: extractAndSaveMemory(fullResponse, messages) → append new facts to memory.md
```

### Memory write-back (step 9 detail)

After the assistant turn completes, TongSense makes a second lightweight call to NemoClaw with a short extraction prompt:

```
System: Extract any new facts about the user from this conversation turn.
        Return JSON: { "new_facts": ["fact1", "fact2"] } or { "new_facts": [] }.
        Only return facts that are not already in the existing memory.

User turn: "{last user message}"
Assistant turn: "{last assistant message}"
Existing memory: "{current memory.md contents}"
```

Facts returned are appended to the `memory.md` file under the appropriate section. This call is fire-and-forget — it does not block the voice stream.

---

## 7. Backend: `/api/voice/chat`

**File:** `app/api/voice/chat/route.ts`

### Request shape (from ElevenLabs)

ElevenLabs sends standard OpenAI chat completions format:

```typescript
interface VoiceChatRequest {
  model: string;          // whatever model name is configured in ElevenLabs — ignored
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  stream: boolean;        // always true from ElevenLabs
  temperature?: number;
  max_tokens?: number;
}
```

### Response shape (to ElevenLabs)

Standard OpenAI SSE streaming format:

```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":" there"},"index":0}]}
data: [DONE]
```

### Handler pseudocode

```typescript
export async function POST(req: Request): Promise<Response> {
  // 1. Signature verification
  const signature = req.headers.get("ElevenLabs-Signature");
  if (!verifyElevenLabsSignature(await req.clone().text(), signature, env.elevenlabs.apiKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse request
  const body: VoiceChatRequest = await req.json();
  const sessionId = getSessionId(req);  // from cookie or X-Session-Id header

  // 3. Load context
  const memory = await loadMemory(sessionId);
  const routeContext = getRouteContext(sessionId);  // from in-memory RouteStore

  // 4. Build enriched system message
  const systemMessage = buildSystemPrompt(memory, routeContext);

  // 5. Filter out any existing system messages from ElevenLabs, prepend ours
  const messages = [
    { role: "system", content: systemMessage },
    ...body.messages.filter(m => m.role !== "system"),
  ];

  // 6. Forward to NemoClaw with streaming
  const nemoclawRes = await fetch(`${env.nemoclaw.inferenceUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.nemoclaw.apiKey}`,
    },
    body: JSON.stringify({
      model: env.nemoclaw.model,
      messages,
      stream: true,
      temperature: 0.4,
      max_tokens: 256,   // voice responses must be short
    }),
  });

  if (!nemoclawRes.ok) {
    return new Response("Inference unavailable", { status: 503 });
  }

  // 7. Pipe stream + accumulate for post-turn memory write
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  let fullResponse = "";

  (async () => {
    const reader = nemoclawRes.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullResponse += extractTextFromSSEChunk(chunk);
      await writer.write(value);
    }
    await writer.close();

    // 8. Post-turn: extract and save memory (fire-and-forget)
    extractAndSaveMemory(sessionId, body.messages, fullResponse).catch(console.error);
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

### Session ID

The session ID is used to key the `memory.md` file. Source of truth (in priority order):
1. `X-Session-Id` request header (set by ElevenLabs if configured in agent settings as a custom header)
2. `session_id` cookie (set by TongSense on first page load via `app/layout.tsx`)
3. Fallback: `"default"` (single-user dev mode)

For production multi-user, the session ID should be set as a cookie on the browser and forwarded to ElevenLabs as a custom header in the `useConversation` SDK call.

---

## 8. Memory System

**File:** `lib/voice/memory.ts`  
**Storage:** `data/voice/memory-{sessionId}.md` (filesystem, relative to project root)  
**Git status:** `data/` directory is git-ignored

### Memory file format

```markdown
# User Memory

## Profile
- Mobility: wheelchair user
- Avoids: stairs, steep inclines, cobblestones
- Prefers: step-free routes, lifts over escalators
- Walking speed: slow

## Journey Preferences
- Home station: King's Cross St. Pancras
- Workplace: Canary Wharf
- Frequent destination: Victoria Station

## Accessibility Requirements
- Requires: step-free access throughout
- Alert on: platform gaps, out-of-service lifts

## Session Notes
- Last journey: King's Cross → Victoria, selected Route A
- Prefers to be warned about crowding before boarding
```

### API

```typescript
// lib/voice/memory.ts

export async function loadMemory(sessionId: string): Promise<string>
// Returns full memory.md contents as string, or "" if file doesn't exist

export async function appendFacts(sessionId: string, facts: string[]): Promise<void>
// Appends new facts to appropriate sections in memory.md
// Creates file if it doesn't exist

export async function extractAndSaveMemory(
  sessionId: string,
  messages: ChatMessage[],
  assistantResponse: string
): Promise<void>
// Calls NemoClaw with extraction prompt, then calls appendFacts()
// Fire-and-forget — caller does not await
```

### Memory extraction prompt

```
You are a memory extraction assistant. Given a conversation turn, identify any NEW facts
about the user that should be remembered for future conversations.

Return ONLY valid JSON in this exact format:
{
  "new_facts": [
    "Mobility: wheelchair user",
    "Avoids: stairs"
  ]
}

Return { "new_facts": [] } if no new facts are present.
Do NOT repeat facts that are already in the existing memory.
Do NOT include route-specific details that will change next session.
DO include: mobility needs, accessibility requirements, preferences, frequent locations.

Existing memory:
{memory}

Last user message: {userMessage}
Last assistant message: {assistantMessage}
```

This extraction call uses a low `max_tokens` (128) and `temperature: 0` — it is deterministic and cheap.

---

## 9. Context Builder

**File:** `lib/voice/context-builder.ts`

### System prompt structure

```typescript
export function buildSystemPrompt(memory: string, routeContext: RouteContext): string {
  return [
    VOICE_PERSONA,
    memory ? `<memory>\n${memory}\n</memory>` : "",
    routeContext ? `<current-map>\n${formatRouteContext(routeContext)}\n</current-map>` : "",
    MAP_COMMAND_INSTRUCTIONS,
  ].filter(Boolean).join("\n\n");
}
```

### `VOICE_PERSONA` (static, never changes)

```
You are TongSense, an accessibility-aware journey guide for London.
You help users navigate the city safely, with special attention to their mobility needs.

CRITICAL VOICE RULES — follow these on every single response:
- Maximum 2 sentences per response. Never more.
- Spoken English only. No markdown, no bullet points, no headers, no lists, no code.
- Do not say "certainly", "absolutely", "of course", "great question", or similar filler.
- Be direct and warm. You are a knowledgeable local guide, not a chatbot.
- If you do not know something, say so in one sentence.

When you learn something about the user (accessibility needs, preferences, frequent
destinations), remember it — you will never ask the same question twice.
```

### `MAP_COMMAND_INSTRUCTIONS` (static)

```
When you need to update the map (show routes, highlight a route, mark a hazard),
emit a JSON command on its own line in this exact format:
{"map_command":"show_routes","from":"<origin>","to":"<destination>"}
{"map_command":"highlight_route","routeId":"A"}
{"map_command":"show_hazard","lat":51.5074,"lng":-0.1278,"label":"lift out of service"}

The user will not see these commands — they are processed by the app automatically.
Always emit the map_command BEFORE the spoken response text.
```

### `formatRouteContext` output

```
From: King's Cross St. Pancras → To: Victoria
Routes available:
  Route A: 28 min, step-free throughout, accessibility score 94/100
  Route B: 22 min, 1 step at Green Park (lift available), accessibility score 81/100
  Route C: 31 min, fully step-free, least crowded, accessibility score 97/100
Current recommendation: Route C (least crowded, fully step-free)
Live alerts: Circle line minor delays
No active disruptions on recommended route.
```

### `RouteContext` type

```typescript
interface RouteContext {
  sessionId: string;
  from?: string;
  to?: string;
  routes?: Array<{
    id: string;                // "A", "B", "C"
    durationMinutes: number;
    accessibilityScore: number;
    stepFree: boolean;
    summary: string;           // human-readable one-liner
  }>;
  recommendation?: string;     // routeId
  alerts?: string[];           // live TfL alerts
  lastUpdated?: number;        // timestamp
}
```

### RouteStore

`RouteContext` is populated by a server-side in-memory store (`lib/voice/route-store.ts`) that is updated whenever `/api/routes` is called. This is a simple `Map<sessionId, RouteContext>` that lives in the Next.js server process. On each `/api/routes` response, the handler also calls `RouteStore.set(sessionId, context)`.

For production deployment with multiple Next.js instances, replace `RouteStore` with a Redis key-value store. For single-instance dev, the in-memory Map is sufficient.

---

## 10. NemoClaw Inference Provider

**File:** `lib/agent/providers/nemoclaw.ts`

This provider follows the exact same interface as `lib/agent/providers/gemini.ts` (which it can be read as a reference for). It is used exclusively by `/api/voice/chat` — the existing Gemini provider is unchanged.

```typescript
// lib/agent/providers/nemoclaw.ts

import type { AgentProvider, MobilityAgentContext, MobilityRecommendation } from "../types";
import { env } from "../../config/env";

export class NemoClawProvider implements AgentProvider {
  async recommend(context: MobilityAgentContext): Promise<MobilityRecommendation> {
    // Used for the one-shot text recommendation path if ever needed.
    // The streaming voice path is handled directly in /api/voice/chat.
    const response = await fetch(`${env.nemoclaw.inferenceUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.nemoclaw.apiKey}`,
      },
      body: JSON.stringify({
        model: env.nemoclaw.model,
        messages: [
          { role: "system", content: buildRecommendationSystemPrompt() },
          { role: "user", content: buildRecommendationUserPrompt(context) },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) throw new Error(`NemoClaw error: ${response.status}`);
    const data = await response.json();
    return parseRecommendation(data.choices[0].message.content);
  }
}
```

### env.ts additions

Add to `lib/config/env.ts`:

```typescript
nemoclaw: {
  inferenceUrl: process.env.NEMOCLAW_INFERENCE_URL ?? "http://localhost:18789/v1",
  apiKey: process.env.NEMOCLAW_API_KEY ?? "",
  model: process.env.NEMOCLAW_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
  get enabled() { return Boolean(this.apiKey); },
},
elevenlabs: {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  agentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "",
  get enabled() { return Boolean(this.apiKey && this.agentId); },
},
voiceMemoryDir: process.env.VOICE_MEMORY_DIR ?? "./data/voice",
```

---

## 11. Frontend: VoicePanel Component

**File:** `components/VoicePanel.tsx`  
**Package required:** `@11labs/react` (ElevenLabs React SDK)

### Installation

```bash
cd /home/mark/TongSense
npm install @11labs/react
```

### Component states

```
idle        → dark panel, large mic button (🎙), "Tap to speak" label
connecting  → spinner + "Connecting…"
listening   → pulsing cyan ring around mic icon, "Listening…"
thinking    → three-dot animation, "Thinking…"
speaking    → animated waveform bars (cyan), agent text transcript fades in
error       → red banner + error message + "Try again" button
```

### Component sketch

```typescript
"use client";

import { useConversation } from "@11labs/react";
import { useVoiceRoute } from "../lib/voice/VoiceRouteContext";

export function VoicePanel() {
  const { dispatchMapCommand } = useVoiceRoute();
  const [transcript, setTranscript] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const conversation = useConversation({
    agentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID!,
    onMessage: ({ message, source }) => {
      setTranscript(prev => [...prev.slice(-4), `${source}: ${message}`]);
      // Parse map_command blocks
      const commandMatch = message.match(/\{"map_command"[^}]+\}/);
      if (commandMatch) {
        try {
          dispatchMapCommand(JSON.parse(commandMatch[0]));
        } catch { /* malformed JSON — ignore */ }
      }
    },
    onError: (err) => setError(err.message ?? "Voice error"),
    onConnect: () => setError(null),
  });

  const isActive = conversation.status !== "disconnected";

  return (
    <div className="rounded-xl bg-slate-800 p-4 space-y-3">
      {/* Mic button */}
      <button
        onClick={() => isActive ? conversation.endSession() : conversation.startSession()}
        className={micButtonClasses(conversation.status, conversation.isSpeaking)}
      >
        {micButtonIcon(conversation.status, conversation.isSpeaking)}
      </button>

      {/* Status label */}
      <p className="text-sm text-slate-400 text-center">
        {statusLabel(conversation.status, conversation.isSpeaking)}
      </p>

      {/* Transcript (last 5 turns) */}
      {transcript.length > 0 && (
        <div className="text-xs text-slate-500 space-y-1 max-h-32 overflow-y-auto">
          {transcript.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded bg-red-900/40 text-red-300 text-xs p-2">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Divider + fallback hint */}
      <div className="text-xs text-slate-600 text-center pt-1">or use the form below</div>
    </div>
  );
}
```

### Layout placement in `app/page.tsx`

`VoicePanel` is inserted at the **top of the left sidebar**, above the existing From/To form. The existing `MobilityAgentPanel` is kept below as a text fallback showing the last recommendation. When voice is active, the From/To form is visually collapsed (CSS `hidden` or `opacity-50`) but not removed from the DOM.

---

## 12. Frontend: VoiceRouteContext Bridge

**File:** `lib/voice/VoiceRouteContext.tsx`

This React context allows `VoicePanel` to trigger map updates without prop drilling through `app/page.tsx`.

```typescript
// lib/voice/VoiceRouteContext.tsx

"use client";

export type MapCommand =
  | { map_command: "show_routes"; from: string; to: string }
  | { map_command: "highlight_route"; routeId: string }
  | { map_command: "show_hazard"; lat: number; lng: number; label: string };

interface VoiceRouteContextValue {
  pendingCommand: MapCommand | null;
  dispatchMapCommand: (cmd: MapCommand) => void;
  clearCommand: () => void;
}

const VoiceRouteContext = createContext<VoiceRouteContextValue>({
  pendingCommand: null,
  dispatchMapCommand: () => {},
  clearCommand: () => {},
});

export function VoiceRouteProvider({ children }: { children: React.ReactNode }) {
  const [pendingCommand, setPendingCommand] = useState<MapCommand | null>(null);
  return (
    <VoiceRouteContext.Provider value={{
      pendingCommand,
      dispatchMapCommand: setPendingCommand,
      clearCommand: () => setPendingCommand(null),
    }}>
      {children}
    </VoiceRouteContext.Provider>
  );
}

export const useVoiceRoute = () => useContext(VoiceRouteContext);
```

`VoiceRouteProvider` wraps the main layout in `app/layout.tsx` (or `app/page.tsx` if kept client-side).

---

## 13. Frontend: RouteMap Integration

**File:** `components/RouteMap.tsx` (modified)

Add a `useEffect` that watches `pendingCommand` from `VoiceRouteContext`:

```typescript
// Inside RouteMap component
const { pendingCommand, clearCommand } = useVoiceRoute();

useEffect(() => {
  if (!pendingCommand) return;

  if (pendingCommand.map_command === "show_routes") {
    // Trigger the existing route fetch flow with new from/to
    onVoiceRouteRequest?.(pendingCommand.from, pendingCommand.to);
    clearCommand();
  } else if (pendingCommand.map_command === "highlight_route") {
    setSelectedRoute(pendingCommand.routeId);
    clearCommand();
  } else if (pendingCommand.map_command === "show_hazard") {
    addHazardMarker(pendingCommand.lat, pendingCommand.lng, pendingCommand.label);
    clearCommand();
  }
}, [pendingCommand]);
```

`onVoiceRouteRequest` is a new optional prop added to `RouteMap` — it calls up to `page.tsx` which triggers `useLiveRoutes` with the new from/to values. This mirrors the existing form submit flow.

---

## 14. ElevenLabs Agent Configuration

This is configured in the **ElevenLabs web dashboard** (elevenlabs.io), not in code.

### Step-by-step setup

1. Create account at elevenlabs.io
2. Navigate to **Conversational AI → Agents → Create Agent**
3. **LLM settings:**
   - LLM: `Custom LLM`
   - Custom LLM URL: `https://<your-public-domain>/api/voice/chat`
     (For local dev: use `ngrok http 3000` to get a public HTTPS URL, e.g. `https://abc123.ngrok.io/api/voice/chat`. ElevenLabs requires HTTPS even in dev.)
   - Model name: `nemoclaw` (arbitrary string)
4. **Voice settings:**
   - Voice: choose English voice (Rachel recommended for accessibility warmth)
   - Stability: 0.7, Similarity: 0.8
5. **Agent behaviour:**
   - First message: `Hello, I'm TongSense. Where would you like to go today?`
   - System prompt: **leave blank** — TongSense injects the full system prompt on every call
6. **Turn detection:**
   - VAD: ElevenLabs default (server-side)
   - Min silence: 0.5s (lower for more responsive conversation)
7. **Custom headers** (for session ID):
   - Add header: `X-Session-Id` with value `{{session_id}}` if ElevenLabs supports dynamic headers; otherwise set a static value for single-user dev
8. Copy the **Agent ID** → set as `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` env var
9. Copy the **API key** → set as `ELEVENLABS_API_KEY` env var (server-side only, for signature verification)

### Local dev testing with ElevenLabs CLI

The ElevenLabs CLI can be used to test the agent locally without a deployed URL:

```bash
npm install -g @11labs/cli
elevenlabs agent test --agent-id <AGENT_ID> --custom-llm http://localhost:3000/api/voice/chat
```

This lets you validate the `/api/voice/chat` endpoint without needing HTTPS or a tunnel.

---

## 15. Environment Variables

### New variables to add to `.env.local` and `.env.local.example`

```ini
# ── ElevenLabs Conversational AI ──────────────────────────────────────────
# Server-side: used for HMAC signature verification of incoming requests
ELEVENLABS_API_KEY=

# Client-side: ElevenLabs agent ID (safe to expose — it's a public identifier)
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=

# ── NemoClaw Inference Endpoint ───────────────────────────────────────────
# The OpenAI-compatible inference URL from the NemoClaw sandbox
# After `nemoclaw <sandbox> start`, port-forwarded to localhost:18789 by default
NEMOCLAW_INFERENCE_URL=http://localhost:18789/v1

# API credential from `nemoclaw onboard` output
NEMOCLAW_API_KEY=

# Model to use — must match a model configured in NemoClaw
NEMOCLAW_MODEL=nvidia/nemotron-3-super-120b-a12b

# ── Voice Memory Storage ──────────────────────────────────────────────────
# Directory where per-session memory.md files are stored (git-ignored)
VOICE_MEMORY_DIR=./data/voice
```

### Existing variables (unchanged)

```ini
TFL_APP_ID=               # TfL API App ID
TFL_APP_KEY=              # TfL API key (required for live routes)
GEMINI_API_KEY=           # Still used by /api/agent/recommend (text path)
GEMINI_MODEL=gemini-2.0-flash
LLM_PROVIDER=gemini       # Still controls text path
NEXT_PUBLIC_LLM_PROVIDER=gemini
```

### `.gitignore` additions

```
data/voice/
```

---

## 16. Security

### ElevenLabs request signature verification

**File:** `lib/voice/auth.ts`

ElevenLabs signs each request to the custom LLM endpoint with an HMAC-SHA256 signature in the `ElevenLabs-Signature` header. The `/api/voice/chat` handler verifies this before processing anything.

```typescript
export async function verifyElevenLabsSignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const expected = await hmacSHA256(secret, body);
  return timingSafeEqual(expected, signatureHeader);
}
```

If verification fails: return `401 Unauthorized`. Do not log the request body (may contain user audio transcripts).

### NemoClaw API key

`NEMOCLAW_API_KEY` is server-side only (no `NEXT_PUBLIC_` prefix). It is never sent to the browser. The NemoClaw inference endpoint is only accessible from the TongSense backend process.

### Memory file isolation

Memory files are keyed by `sessionId`. The session ID comes from a cookie set by TongSense, not from the ElevenLabs request body. This prevents a malicious ElevenLabs request from reading another user's memory by spoofing a session ID (the HMAC verification is the outer guard; the cookie is the inner guard).

Memory files are stored outside `public/` and are not accessible via HTTP — only server-side code can read/write them.

### Voice transcript privacy

Conversation transcripts are **not** persisted. Only extracted facts (non-PII: mobility needs, preferences) are written to `memory.md`. Raw transcripts exist only in ElevenLabs cloud (subject to their retention policy) and in the in-flight stream through TongSense.

---

## 17. Error Handling & Degradation

### Error matrix

| Error | Detection | User experience | System behaviour |
|-------|-----------|-----------------|------------------|
| Mic permission denied | Browser API | VoicePanel shows: "Microphone access needed — use the form below" | Panel collapses to hint; form stays visible |
| ElevenLabs WebSocket drop | SDK `onError` | Auto-retry once (ElevenLabs SDK handles); then: "Voice unavailable" banner | Form remains usable |
| NemoClaw inference timeout (>8s) | HTTP timeout in `/api/voice/chat` | ElevenLabs receives 504, speaks its own error message | TongSense logs the failure with session ID |
| NemoClaw sandbox unreachable | Connection refused | `/api/voice/chat` returns 503 | ElevenLabs speaks "service unavailable"; text form works normally |
| Invalid ElevenLabs signature | HMAC mismatch | 401 (no user-visible effect — ElevenLabs retries) | Log warning with request IP |
| memory.md write failure | Filesystem error | None — conversation continues normally | Log error; memory update skipped silently |
| Route context unavailable (no routes yet) | RouteStore miss | `<current-map>` block says "No active route" | Agent asks user for destination naturally via voice |
| map_command JSON parse failure | try/catch in VoicePanel | None — map does not update | Log parse error; conversation continues |

### Graceful degradation guarantee

- Voice failure **never** breaks the text-based form
- Text form failure **never** breaks voice
- Memory failure **never** breaks the voice conversation
- NemoClaw being down **never** affects the Gemini text path

---

## 18. File Manifest: New Files

All files below are new additions to `/home/mark/TongSense/`.

```
app/api/voice/
└── chat/
    └── route.ts                    # OpenAI-compat proxy + context injection + memory write-back

lib/voice/
├── memory.ts                       # loadMemory(), appendFacts(), extractAndSaveMemory()
├── context-builder.ts              # buildSystemPrompt(), formatRouteContext()
├── auth.ts                         # verifyElevenLabsSignature()
├── route-store.ts                  # In-memory RouteStore (Map<sessionId, RouteContext>)
└── VoiceRouteContext.tsx            # React context: VoiceRouteProvider, useVoiceRoute, MapCommand

lib/agent/providers/
└── nemoclaw.ts                     # NemoClawProvider implementing AgentProvider interface

components/
└── VoicePanel.tsx                  # ElevenLabs SDK + mic UI + transcript + map command dispatch

data/voice/
└── .gitkeep                        # Ensures directory exists; actual memory files are git-ignored
```

---

## 19. File Manifest: Modified Files

```
lib/config/env.ts
  → Add: nemoclaw config block (inferenceUrl, apiKey, model, enabled)
  → Add: elevenlabs config block (apiKey, agentId, enabled)
  → Add: voiceMemoryDir

app/api/routes/route.ts
  → Add: RouteStore.set(sessionId, context) after successful route build
  → Add: extract sessionId from request cookie/header

app/layout.tsx  (or app/page.tsx)
  → Wrap with: <VoiceRouteProvider>

app/page.tsx
  → Add: <VoicePanel /> at top of left sidebar
  → Add: onVoiceRouteRequest prop handler that updates useLiveRoutes from/to
  → Collapse From/To form when voice is active

components/RouteMap.tsx
  → Add: useVoiceRoute() hook
  → Add: useEffect watching pendingCommand
  → Add: onVoiceRouteRequest optional prop

.env.local.example
  → Add: all new env vars listed in Section 15

.gitignore
  → Add: data/voice/

package.json
  → Add: @11labs/react
```

---

## 20. Testing Strategy

### Unit tests (new, in `lib/voice/*.test.ts`)

**`lib/voice/memory.test.ts`**
- `loadMemory` returns `""` when file does not exist
- `loadMemory` returns file contents when file exists
- `appendFacts` creates file with correct markdown structure when file does not exist
- `appendFacts` appends facts to existing file without overwriting existing content
- `appendFacts` does not duplicate facts already in memory

**`lib/voice/context-builder.test.ts`**
- `buildSystemPrompt` with memory + route context: output contains `<memory>` block and `<current-map>` block
- `buildSystemPrompt` with no memory: no `<memory>` block in output
- `buildSystemPrompt` with no route context: `<current-map>` says "No active route"
- `formatRouteContext` formats step-free routes correctly
- `formatRouteContext` includes live alerts when present

**`lib/voice/auth.test.ts`**
- `verifyElevenLabsSignature` returns `true` for valid HMAC
- `verifyElevenLabsSignature` returns `false` for tampered body
- `verifyElevenLabsSignature` returns `false` for missing header
- `verifyElevenLabsSignature` returns `false` for empty secret

### Integration tests (`app/api/voice/chat/route.test.ts`)

- Valid ElevenLabs request → NemoClaw mock → SSE stream proxied correctly
- Invalid signature → 401
- NemoClaw returns 500 → `/api/voice/chat` returns 503
- NemoClaw connection refused → `/api/voice/chat` returns 503
- Request with empty messages array → handled without crash

### Manual test checklist (no automation needed)

```
□ Browser opens TongSense, mic button visible in VoicePanel
□ Tapping mic → browser prompts for microphone permission
□ After permission granted: VoicePanel shows "Listening..." state
□ Speaking "I need to get to Victoria" → agent responds via speaker with route info
□ RouteMap updates with new routes (from/to populated, route overlays drawn)
□ Agent learns "wheelchair user" from conversation
□ memory.md file created at data/voice/memory-<sessionId>.md with wheelchair fact
□ New session (same sessionId): agent knows user is wheelchair user, never asks again
□ NemoClaw sandbox stopped → voice error banner appears, text form still works
□ Mic permission denied → form hint visible, text form still works
□ ElevenLabs CLI test: `elevenlabs agent test --agent-id <ID> --custom-llm http://localhost:3000/api/voice/chat`
```

---

## 21. Out of Scope

The following are explicitly excluded from this implementation phase:

1. **Video/image stream ingestion** — the hook points are designed in (see Section 22) but no implementation
2. **Computer vision obstacle detection** — future CV pipeline; `services/cv/` exists as a mock stub
3. **Production multi-user auth** — session isolation by cookie is sufficient for single-user / demo
4. **Memory encryption at rest** — plaintext markdown files; acceptable for prototype
5. **Redis/distributed RouteStore** — in-memory Map is sufficient for single Next.js instance
6. **ElevenLabs CLI as runtime component** — CLI is dev tooling only; not part of the runtime system
7. **NemoClaw codebase changes** — NemoClaw is used as-is; no plugin modifications
8. **Replacing the Gemini text path** — `/api/agent/recommend` with Gemini stays untouched
9. **Telegram/Slack/Discord channels** — not in scope; TongSense remains web-only this phase
10. **Automated E2E voice tests** — WebAudio/WebSocket automation is brittle; manual checklist is sufficient

---

## 22. Future Extension Points

This design is deliberately structured to make the following additions easy:

### Video/image stream (computer vision)

`VoicePanel` gains a `<video>` element for camera. On each turn (or on demand), a frame is extracted from the canvas and POSTed to a new endpoint:

```
POST /api/vision/analyze
Body: { frame: base64, sessionId, turnId }
Response: { obstacles: string[], confidence: number }
```

The result is injected into the `<current-map>` context block by `context-builder.ts`:

```
Obstacles detected by camera: pothole ahead (high confidence), narrow pavement
```

No changes to `/api/voice/chat` or NemoClaw wiring needed — it's a pure context enrichment.

### Additional messaging channels (Telegram, WhatsApp)

The memory system and context builder are channel-agnostic. A Telegram bot handler would:
1. Receive a text message from Telegram
2. Call `buildSystemPrompt(memory, routeContext)` (same function)
3. Call NemoClaw directly (bypassing ElevenLabs)
4. Reply with text via Telegram API

The `RouteStore` and `memory.md` are shared across channels if the session ID maps to the same user.

### Multi-language support

`VOICE_PERSONA` in `context-builder.ts` is a single string constant. Replacing it with a locale-keyed map supports multiple languages. ElevenLabs supports multi-language TTS voices natively.

### Pluggable LLM backends

`lib/agent/providers/nemoclaw.ts` follows the same `AgentProvider` interface as `gemini.ts` and `claude.ts` (the stubs that already exist in TongSense). Swapping the inference backend requires only a new provider file and a config change.

---

## 23. Glossary

| Term | Definition |
|------|-----------|
| **NemoClaw** | NVIDIA open-source stack for running AI agents inside OpenShell sandboxes. Used here as an inference endpoint provider. |
| **OpenShell** | NVIDIA container sandbox platform. NemoClaw manages sandboxes on top of it. |
| **ElevenLabs Conversational AI** | Hosted voice agent platform. Handles VAD, STT, TTS, and turn management. Calls our custom LLM endpoint per turn. |
| **VAD** | Voice Activity Detection — automatic detection of when the user starts and stops speaking. Handled by ElevenLabs cloud. |
| **STT** | Speech-to-Text — transcription of user audio to text. Handled by ElevenLabs cloud. |
| **TTS** | Text-to-Speech — synthesis of agent text response to audio. Handled by ElevenLabs cloud. |
| **Custom LLM** | ElevenLabs feature that lets you point the LLM turn to any OpenAI-compatible endpoint. TongSense's `/api/voice/chat` acts as this endpoint. |
| **OpenAI chat completions format** | The HTTP request/response protocol used by OpenAI's `/v1/chat/completions` API. ElevenLabs and NemoClaw both speak this protocol. |
| **SSE** | Server-Sent Events — streaming protocol used for chat completions. One `data: {...}` line per token chunk, terminated by `data: [DONE]`. |
| **memory.md** | Per-session markdown file storing persistent facts about the user (accessibility needs, preferences). Injected as context on every voice turn. |
| **RouteStore** | Server-side in-memory Map that holds the latest route context per session, so `/api/voice/chat` can inject current route state into every prompt. |
| **VoiceRouteContext** | React context that bridges `VoicePanel` (voice) and `RouteMap` (map) without prop drilling. `VoicePanel` dispatches `MapCommand` objects; `RouteMap` handles them. |
| **MapCommand** | Structured JSON object emitted by the LLM in its response text. Parsed by `VoicePanel` to trigger map updates. Never spoken aloud by TTS. |
| **TfL** | Transport for London — the public transit authority for London. TongSense queries TfL APIs for live route and service status data. |
| **OSM** | OpenStreetMap — open map data. TongSense queries OSM for accessibility features (steps, crossings, tactile paving). |
| **HMAC** | Hash-based Message Authentication Code — used by ElevenLabs to sign webhook requests so TongSense can verify they are legitimate. |
| **Session ID** | A unique identifier per browser session, used to key memory.md files and RouteStore entries. Set as a cookie by TongSense. |
