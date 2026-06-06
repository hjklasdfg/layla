import type { AgentProvider, MobilityAgentContext, MobilityRecommendation } from "@/lib/agent/types";
import { serverEnv } from "@/lib/config/env";

function buildSystemPrompt(): string {
  return `You are a mobility route recommendation engine. Given route options and user preferences, recommend the best route.
Return ONLY valid JSON in this exact format:
{"recommendedRouteId":"A","reason":"<one sentence>","warnings":["<optional>"]}`;
}

function buildUserPrompt(ctx: MobilityAgentContext): string {
  const routesSummary = ctx.routes
    .map((r) => {
      const signals = JSON.stringify(r.signals ?? {});
      return `Route ${r.routeId}: ${signals}`;
    })
    .join("\n");

  return `Profile: ${ctx.preference.profile}
Priority: ${ctx.preference.priority}${ctx.preference.customNotes ? `\nNotes: ${ctx.preference.customNotes}` : ""}
Journey: ${ctx.journey.start} → ${ctx.journey.destination}
Routes:
${routesSummary || "(none)"}`;
}

export class NemoClawProvider implements AgentProvider {
  async recommend(context: MobilityAgentContext): Promise<MobilityRecommendation> {
    const response = await fetch(
      `${serverEnv.nemoclaw.inferenceUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.nemoclaw.apiKey}`,
        },
        body: JSON.stringify({
          model: serverEnv.nemoclaw.model,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(context) },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`NemoClaw error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(raw) as MobilityRecommendation;
  }
}
