import "server-only";

import type { MobilityAgentContext, MobilityRecommendation } from "./types";
import { serverEnv } from "@/lib/config/env";

function buildSystemPrompt(): string {
  return `You are a mobility route recommendation engine for TongSense.
Given route options and user preferences, select the best route.
Return ONLY valid JSON:
{"recommendedRouteId":"<id>","reason":"<one sentence>","warnings":["<optional>"]}`;
}

function buildUserPrompt(ctx: MobilityAgentContext): string {
  const routeSummaries = ctx.routes
    .map((r) => {
      const signals = r.signals;
      return `Route ${r.routeId}: ETA ${r.etaMin}min, accessibility=${signals.accessibility}, stress=${signals.stress}, modes=${r.modes.join("+")}`;
    })
    .join("\n");

  return `Profile: ${ctx.preference.profile}
Priority: ${ctx.preference.priority}${ctx.preference.customNotes ? `\nCustom notes: ${ctx.preference.customNotes}` : ""}
Journey: ${ctx.journey.start} → ${ctx.journey.destination}

${routeSummaries}`;
}

export async function generateMobilityRecommendationServer(
  ctx: MobilityAgentContext
): Promise<MobilityRecommendation> {
  if (!serverEnv.gemini.enabled) {
    const sorted = [...ctx.routes].sort(
      (a, b) => b.signals.accessibility - a.signals.accessibility
    );
    const best = sorted[0];
    return {
      recommendedRouteId: best?.routeId ?? ctx.routes[0]?.routeId ?? "A",
      reason: "Highest accessibility score",
      warnings: [],
    };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${serverEnv.gemini.model}:generateContent?key=${serverEnv.gemini.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildSystemPrompt() },
              { text: buildUserPrompt(ctx) },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini error: ${res.status}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini returned non-JSON response");
  }

  return JSON.parse(jsonMatch[0]) as MobilityRecommendation;
}
