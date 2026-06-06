#!/usr/bin/env node
/**
 * Test Layla → backend contract using Gemini as a stand-in backend.
 *
 * Usage:
 *   node scripts/test-gemini-backend.mjs              # call Gemini with sample payload
 *   node scripts/test-gemini-backend.mjs --dry-run    # print input only, no API call
 *   node scripts/test-gemini-backend.mjs --live-tfl   # fetch real TfL candidates (needs TFL_APP_KEY)
 *
 * Reads GEMINI_API_KEY, GEMINI_MODEL, TFL_APP_KEY from frontend/.env.local
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvLocal() {
  const env = {};
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // .env.local optional for --dry-run
  }
  return env;
}

/** What Layla POSTs to {BACKEND}/mobility/plan */
function buildSampleRequest() {
  return {
    audioInput: "Take me from King's Cross to the British Museum, step-free if possible",
    gps: {
      latitude: 51.5308,
      longitude: -0.1238,
      accuracy: 12,
      timestamp: Date.now(),
    },
    cameraData: [
      {
        routeId: "A",
        observation: {
          crowdDensity: 0.6,
          obstacleDensity: 0.2,
          crossingVisibility: 0.85,
        },
        evidence: ["Busy pavement on Euston Road", "Clear crossing at signal"],
      },
    ],
    preference: {
      profile: "wheelchair",
      priority: "most_accessible",
      customNotes: "Avoid long walks between stations",
    },
    journey: {
      start: "King's Cross St. Pancras",
      destination: "British Museum",
    },
    tflJourney: {
      from: "King's Cross St. Pancras",
      to: "British Museum",
      candidates: [
        {
          id: "A",
          etaMin: 18,
          transferCount: 1,
          walkingMinutes: 6,
          modes: ["tube", "walking"],
          disruptions: [],
          instructions: [
            "Take Northern line southbound to Tottenham Court Road",
            "Walk 8 min to British Museum",
          ],
          steps: [
            {
              order: 1,
              mode: "tube",
              modeLabel: "Tube",
              durationMin: 4,
              from: "King's Cross St. Pancras",
              to: "Tottenham Court Road",
              line: "Northern",
              instruction: "Northern line southbound",
            },
            {
              order: 2,
              mode: "walking",
              modeLabel: "Walk",
              durationMin: 8,
              from: "Tottenham Court Road",
              to: "British Museum",
              instruction: "Walk via Bloomsbury",
            },
          ],
          stopPointIds: ["940GZZLUKSX", "940GZZLUTCR"],
          lineIds: ["northern"],
          rawJourney: { duration: 18 },
        },
        {
          id: "B",
          etaMin: 14,
          transferCount: 0,
          walkingMinutes: 12,
          modes: ["bus", "walking"],
          disruptions: ["Bus stop closed on Euston Road — use stop B"],
          instructions: ["Bus 73 to Russell Square", "Walk 5 min to museum"],
          steps: [
            {
              order: 1,
              mode: "bus",
              modeLabel: "Bus",
              durationMin: 9,
              from: "King's Cross",
              to: "Russell Square",
              line: "73",
              instruction: "Bus 73 towards Victoria",
            },
            {
              order: 2,
              mode: "walking",
              modeLabel: "Walk",
              durationMin: 5,
              from: "Russell Square",
              to: "British Museum",
              instruction: "Walk via Montague Place",
            },
          ],
          stopPointIds: ["490008660N", "490000119W"],
          lineIds: ["73"],
          rawJourney: { duration: 14 },
        },
        {
          id: "C",
          etaMin: 22,
          transferCount: 0,
          walkingMinutes: 20,
          modes: ["walking"],
          disruptions: [],
          instructions: ["Walk via Cartwright Gardens and Bloomsbury"],
          steps: [
            {
              order: 1,
              mode: "walking",
              modeLabel: "Walk",
              durationMin: 22,
              from: "King's Cross St. Pancras",
              to: "British Museum",
              instruction: "Direct walk",
            },
          ],
          stopPointIds: [],
          lineIds: [],
          rawJourney: { duration: 22 },
        },
      ],
    },
  };
}

const SYSTEM_PROMPT = `You are the Layla mobility backend. You receive a POST /mobility/plan payload from the Layla frontend.

Your job:
1. Pretend you enriched each TfL candidate with OSM accessibility data (steps, lifts, tactile paving, kerbs).
2. Score routes for the user's profile and priority.
3. Pick the best route and explain why.

Return JSON only (no markdown fences) matching this shape:
{
  "journey": { "start": string, "destination": string },
  "recommendation": {
    "recommendedRouteId": "A" | "B" | "C",
    "routeComparison": "markdown string comparing all routes",
    "tradeoffExplanation": "markdown string on trade-offs",
    "finalRecommendation": "markdown string with final pick"
  },
  "explanation": {
    "uiText": "longer markdown for the UI panel — why this route was picked",
    "voiceText": "1-2 plain sentences for ElevenLabs to read verbatim (no markdown)"
  },
  "enrichedRoutes": [
    {
      "routeId": "A",
      "osmNotes": ["lift at King's Cross", "..."],
      "scores": {
        "accessibility": 0-100,
        "stress": 0-100,
        "reliability": 0-100
      }
    }
  ],
  "meta": {
    "source": "backend",
    "from": string,
    "to": string,
    "count": number,
    "profile": string,
    "osmWarning": optional string
  }
}`;

async function fetchLiveTfLCandidates(from, to, appKey) {
  const params = new URLSearchParams({
    from,
    to,
    mode: "tube,bus,walking",
    journeyResults: "3",
    app_key: appKey,
  });
  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TfL ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const journeys = data.journeys ?? [];
  return journeys.slice(0, 3).map((j, i) => ({
    id: String.fromCharCode(65 + i),
    etaMin: Math.round((j.duration ?? 0) / 60),
    transferCount: Math.max(0, (j.legs?.length ?? 1) - 1),
    walkingMinutes: Math.round(
      (j.legs ?? [])
        .filter((leg) => leg.mode?.id === "walking")
        .reduce((sum, leg) => sum + (leg.duration ?? 0), 0) / 60
    ),
    modes: [...new Set((j.legs ?? []).map((leg) => leg.mode?.id ?? "unknown"))],
    disruptions: (j.legs ?? []).flatMap((leg) =>
      (leg.disruptions ?? []).map((d) => d.description ?? d.category ?? "disruption")
    ),
    instructions: (j.legs ?? []).map(
      (leg) => leg.instruction?.summary ?? leg.instruction?.detailed ?? "Continue"
    ),
    steps: [],
    stopPointIds: [],
    lineIds: [],
    rawJourney: { duration: j.duration, legs: j.legs },
  }));
}

async function callGemini(apiKey, model, requestPayload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const userPrompt = [
    "Process this Layla mobility plan request and return the backend JSON response.",
    "",
    "REQUEST PAYLOAD:",
    JSON.stringify(requestPayload, null, 2),
  ].join("\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return { rawText: text, parsed: JSON.parse(text) };
}

function printSection(title, obj) {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const liveTfl = args.has("--live-tfl");
  const env = loadEnvLocal();

  let request = buildSampleRequest();

  if (liveTfl) {
    const appKey = env.TFL_APP_KEY;
    if (!appKey) {
      console.error("TFL_APP_KEY missing in .env.local for --live-tfl");
      process.exit(1);
    }
    const candidates = await fetchLiveTfLCandidates(
      request.journey.start,
      request.journey.destination,
      appKey
    );
    request = {
      ...request,
      tflJourney: {
        ...request.tflJourney,
        candidates,
      },
    };
    console.log(`\nFetched ${candidates.length} live TfL candidates.\n`);
  }

  const geminiInput = {
    systemPrompt: SYSTEM_PROMPT,
    userMessage: {
      instruction: "Process this Layla mobility plan request and return the backend JSON response.",
      requestPayload: request,
    },
  };

  printSection("INPUT → what Layla sends to POST /mobility/plan", request);
  printSection("INPUT → full Gemini prompt (system + user)", geminiInput);

  if (dryRun) {
    printSection(
      "OUTPUT → (dry-run — sample shape only, not from Gemini)",
      buildSampleOutput()
    );
    console.log("\nRun without --dry-run to call Gemini and see a real response.\n");
    return;
  }

  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!apiKey) {
    console.error("\nGEMINI_API_KEY missing in frontend/.env.local");
    console.error("Use --dry-run to see input shape without calling Gemini.\n");
    process.exit(1);
  }

  console.log(`\nCalling Gemini (${model})…\n`);
  const { rawText, parsed } = await callGemini(apiKey, model, request);

  printSection("OUTPUT → raw Gemini text", rawText);
  printSection("OUTPUT → parsed backend response JSON", parsed);

  const outDir = join(ROOT, "scripts", "output");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `gemini-backend-test-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ input: request, geminiInput, output: parsed, rawText }, null, 2)
  );
  console.log(`\nSaved full run to ${outFile}\n`);
}

/** Example output shape for --dry-run */
function buildSampleOutput() {
  return {
    journey: {
      start: "King's Cross St. Pancras",
      destination: "British Museum",
    },
    recommendation: {
      recommendedRouteId: "A",
      routeComparison:
        "**Route A** (18 min): Northern line + 8 min walk — step-free at King's Cross, lift at Tottenham Court Road.\n**Route B** (14 min): Bus 73 — faster but bus stop disruption and more exposure to traffic.\n**Route C** (22 min): Full walk — no transit barriers, longest and most tiring.",
      tradeoffExplanation:
        "For a **wheelchair** user prioritising **most accessible**, Route A balances step-free tube access with a manageable walk. Route B is quicker but the Euston Road stop closure adds uncertainty.",
      finalRecommendation:
        "Take **Route A** — 18 minutes via Northern line with step-free stations and a predictable Bloomsbury walk.",
    },
    explanation: {
      uiText:
        "**Why Route A?**\n\nRoute A uses step-free access at King's Cross and Tottenham Court Road, matching your wheelchair profile. The 8-minute walk is on relatively flat pavements.\n\nRoute B is 4 minutes faster but has a bus disruption and kerb gaps near Russell Square. Route C avoids transit entirely but is 22 minutes of continuous wheeling.",
      voiceText:
        "I recommend Route A: take the Northern line to Tottenham Court Road, then walk to the museum. It's the most step-free option for your journey.",
    },
    enrichedRoutes: [
      {
        routeId: "A",
        osmNotes: ["lift=yes at King's Cross", "tactile paving at Tottenham Court Road"],
        scores: { accessibility: 88, stress: 35, reliability: 82 },
      },
      {
        routeId: "B",
        osmNotes: ["bus_stop displaced", "high traffic on Euston Road"],
        scores: { accessibility: 62, stress: 58, reliability: 55 },
      },
      {
        routeId: "C",
        osmNotes: ["continuous pavement", "no kerb drops on Cartwright Gardens"],
        scores: { accessibility: 75, stress: 45, reliability: 95 },
      },
    ],
    meta: {
      source: "backend",
      from: "King's Cross St. Pancras",
      to: "British Museum",
      count: 3,
      profile: "wheelchair",
    },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
