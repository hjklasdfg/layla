# Gemini Context Usage Analysis — TongSense Frontend

**Model:** `gemini-2.5-flash` (configured via `GEMINI_MODEL`)  
**Call site:** `lib/agent/server-recommend.ts` → `/api/agent/recommend`  
**Context window:** 1,048,576 tokens (Gemini 2.5 Flash)  
**Date:** 2026-06-06

---

## 1. Summary

Every time a user clicks **Compare Routes**, the server sends one request to Gemini to
produce a route recommendation. The request is intentionally minimal: a fixed system
prompt plus a compact per-route summary. Total input consumption is **~95–180 tokens**
depending on the number of routes and whether custom notes are present. The output budget
is capped at **256 tokens**. Combined, a single call consumes at most **~0.04 %** of
Gemini 2.5 Flash's 1 M-token context window — effectively negligible.

| Segment | Min tokens | Typical (4 routes) | Max (4 routes + notes) |
|---|---|---|---|
| System prompt | 52 | 52 | 52 |
| User prompt (baseline) | 43 | 97 | 127 |
| **Total input** | **~95** | **~149** | **~179** |
| Max output budget | 256 | 256 | 256 |
| **Grand total** | **~351** | **~405** | **~435** |
| **% of 1 M window** | **0.033 %** | **0.039 %** | **0.041 %** |

Token counts are estimated at ~4 characters per token (English technical text with
SentencePiece-style tokenisation).

---

## 2. Model Configuration

```ts
// lib/config/env.ts
gemini: {
  apiKey:  process.env.GEMINI_API_KEY ?? "",
  model:   process.env.GEMINI_MODEL    ?? "gemini-2.0-flash",
  get enabled() { return Boolean(this.apiKey); },
},
```

```ts
// lib/agent/server-recommend.ts — generation parameters
generationConfig: { temperature: 0.3, maxOutputTokens: 256 }
```

| Parameter | Value | Effect |
|---|---|---|
| `temperature` | `0.3` | Low randomness — near-deterministic JSON output |
| `maxOutputTokens` | `256` | Hard cap; typical output is 30–60 tokens |
| Context window | 1,048,576 | Leaves 1,047,820+ tokens unused per call |

---

## 3. System Prompt

**Source:** `buildSystemPrompt()` in `lib/agent/server-recommend.ts`  
**Character count:** ~205  **Estimated tokens:** ~52  **% of context:** 0.005 %

```
You are a mobility route recommendation engine for TongSense.
Given route options and user preferences, select the best route.
Return ONLY valid JSON:
{"recommendedRouteId":"<id>","reason":"<one sentence>","warnings":["<optional>"]}
```

The system prompt has three responsibilities:
1. **Role assignment** — sets the model as a specialised route selector, not a
   general assistant.
2. **Task constraint** — "select the best route" bounds the output intent.
3. **Output schema** — enforces a JSON-only response with three named fields, reducing
   post-processing to a single regex match.

The prompt is stateless and immutable at runtime; it never expands and accounts for
a constant **~12.8 %** of all tokens sent per call.

---

## 4. Compositional (User) Prompt

**Source:** `buildUserPrompt(ctx)` in `lib/agent/server-recommend.ts`

The user prompt is built dynamically from a `MobilityAgentContext` object and has
three sections:

```
Profile: {profile}
Priority: {priority}
[Custom notes: {customNotes}]        ← optional, only when profile = "custom"
Journey: {start} → {destination}

Route {id}: ETA {etaMin}min, accessibility={score}, stress={score}, modes={mode+mode}
Route {id}: ETA {etaMin}min, accessibility={score}, stress={score}, modes={mode+mode}
...
```

### 4.1 Token budget by section

| Section | Characters | Tokens | % of call total (typical) |
|---|---|---|---|
| Profile + Priority | ~35 | ~9 | 2.2 % |
| Custom notes (absent) | 0 | 0 | 0 % |
| Custom notes (present, ~20 words) | ~120 | ~30 | 7.4 % |
| Journey line | ~55–75 | ~15–19 | 3.7–4.7 % |
| Route summary × 1 | ~70 | ~18 | 4.4 % |
| Route summary × 4 | ~280 | ~70 | 17.3 % |
| **User prompt total (4 routes, no notes)** | **~360** | **~97** | **24.0 %** |
| **User prompt total (4 routes + notes)** | **~480** | **~127** | **31.4 %** |

### 4.2 Token scaling

The user prompt grows **linearly** with route count. The TfL journey planner returns
at most 4 alternatives (`journeys.slice(0, 4)` in `services/tfl/journey.ts`), so the
maximum route-block size is bounded at ~70 tokens.

---

## 5. Concrete Examples

### Example A — General profile, 4 routes, no custom notes

```
Profile: general
Priority: most_accessible
Journey: King's Cross Station → British Museum

Route A: ETA 22min, accessibility=85, stress=15, modes=Tube+Walking
Route B: ETA 28min, accessibility=72, stress=28, modes=Bus+Walking
Route C: ETA 19min, accessibility=68, stress=32, modes=Tube
Route D: ETA 35min, accessibility=90, stress=10, modes=Walking
```

Estimated input tokens: **~149**  
Expected output:

```json
{"recommendedRouteId":"D","reason":"Route D is fully walking and scores highest on accessibility with the lowest stress, ideal for most_accessible priority.","warnings":[]}
```

Output tokens: ~42

---

### Example B — Wheelchair profile, 2 routes, no notes

```
Profile: wheelchair
Priority: most_accessible
Journey: Waterloo Station → Tate Modern

Route A: ETA 12min, accessibility=91, stress=9, modes=Walking
Route B: ETA 18min, accessibility=78, stress=22, modes=Bus+Walking
```

Estimated input tokens: **~113**  
Expected output:

```json
{"recommendedRouteId":"A","reason":"Route A is step-free walking at 12 minutes with the highest accessibility score, best suited for a wheelchair user.","warnings":[]}
```

Output tokens: ~40

---

### Example C — Custom profile with notes, 3 routes

```
Profile: custom
Priority: least_stressful
Custom notes: Avoid stairs, prefer lifts, sensitive to loud crowds.
Journey: Liverpool Street → Barbican

Route A: ETA 8min, accessibility=62, stress=38, modes=Tube+Walking
Route B: ETA 15min, accessibility=88, stress=12, modes=Bus+Walking
Route C: ETA 11min, accessibility=74, stress=26, modes=Elizabeth line+Walking
```

Estimated input tokens: **~168**  
Expected output:

```json
{"recommendedRouteId":"B","reason":"Route B avoids underground noise and stairs with the lowest stress score, aligning with your sensitivity needs.","warnings":["Route A uses Tube platforms which may have stairs and higher crowd noise"]}
```

Output tokens: ~55

---

## 6. Data Structures

### 6.1 Request body sent to Gemini API

```ts
// lib/agent/server-recommend.ts:43–60
{
  contents: [
    {
      parts: [
        { text: buildSystemPrompt() },   // fixed ~52 tokens
        { text: buildUserPrompt(ctx) },  // dynamic ~43–127 tokens
      ],
    },
  ],
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 256,
  },
}
```

Gemini 2.5 Flash does not use a separate `systemInstruction` field in this
implementation — the system prompt is delivered as the first `part` of the single
`contents` turn. This is functionally equivalent but means both parts share one
conversation role (`user`-side of the contents array).

### 6.2 MobilityAgentContext — input type

```ts
// lib/agent/types.ts
interface MobilityAgentContext {
  routes: EnrichedRoute[];     // 1–4 items
  preference: UserPreference;  // profile + priority + optional customNotes
  journey: {
    start: string;             // e.g. "King's Cross Station"
    destination: string;       // e.g. "British Museum"
  };
}

interface EnrichedRoute {
  routeId: string;             // "A", "B", "C", "D"
  etaMin: number;
  modes: string[];             // ["Tube", "Walking"]
  signals: AccessibilitySignals;
  // ... (disruptions, instructions, evidence omitted from prompt)
}

interface AccessibilitySignals {
  accessibility: number;       // 0–100
  stress: number;              // 0–100
  reliability: number;
  predictability: number;
  crowdingRisk: number;
}
```

Only four fields from `EnrichedRoute` are serialised into the prompt:
`routeId`, `etaMin`, `signals.accessibility`, `signals.stress`, and `modes`.
The remaining fields (`disruptions`, `instructions`, `evidence`, `steps`) are
intentionally excluded, keeping the per-route token cost at ~18 tokens.

### 6.3 MobilityRecommendation — output type

```ts
// lib/agent/types.ts
interface MobilityRecommendation {
  recommendedRouteId: string;  // "A" | "B" | "C" | "D"
  reason: string;              // one sentence
  warnings: string[];          // [] in most cases
}
```

The output is parsed with a regex (`/\{[\s\S]*\}/`) to extract the JSON block from
any surrounding text, then cast directly to `MobilityRecommendation`. No schema
validation is applied at runtime.

---

## 7. Fallback (Gemini Disabled)

When `GEMINI_API_KEY` is absent, `server-recommend.ts` bypasses the API entirely and
returns a deterministic recommendation based on the highest `accessibilityScore`:

```ts
if (!serverEnv.gemini.enabled) {
  const sorted = [...ctx.routes].sort(
    (a, b) => b.signals.accessibility - a.signals.accessibility
  );
  return {
    recommendedRouteId: sorted[0]?.routeId ?? "A",
    reason: "Highest accessibility score",
    warnings: [],
  };
}
```

Token consumption in fallback mode: **0**.

---

## 8. Observations

| # | Observation |
|---|---|
| 1 | Context utilisation is negligible (<0.05 % of 1 M window). There is headroom to add substantial route evidence, real-time disruption text, or OSM feature descriptions without approaching practical limits. |
| 2 | The system prompt uses the `parts` array rather than Gemini's dedicated `systemInstruction` field. Migrating to `systemInstruction` would prevent the system text from being treated as user-turn content and may improve instruction-following. |
| 3 | No output schema enforcement is applied. Gemini 2.5 Flash supports `responseSchema` (JSON Schema) in `generationConfig`; using it would eliminate the regex parse step and guarantee valid JSON. |
| 4 | `maxOutputTokens: 256` is generous relative to observed output (~30–60 tokens). Reducing to 128 would have no practical effect on output quality and halves the reserved output budget. |
| 5 | `accessibility` and `stress` are the only two signals included in the prompt. `reliability` and `predictability` are computed but never sent to Gemini. Including them would add ~8 tokens per route and give the model richer signal for `most_reliable` priority requests. |
| 6 | Custom notes are only included when `profile === "custom"`. For other profiles the `customNotes` field is still accepted by the API but silently dropped, which may surprise callers. |
