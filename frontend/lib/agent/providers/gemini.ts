import { serverEnv } from "@/lib/config/env";
import {
  buildRecommendationUserPrompt,
  parseRecommendationPayload,
  RECOMMENDATION_SYSTEM_PROMPT,
  type AgentProvider,
  type MobilityAgentContext,
  type MobilityRecommendation,
} from "../types";

export class GeminiProvider implements AgentProvider {
  async recommend(context: MobilityAgentContext): Promise<MobilityRecommendation> {
    if (!serverEnv.gemini.enabled) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${serverEnv.gemini.model}:generateContent?key=${serverEnv.gemini.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: RECOMMENDATION_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildRecommendationUserPrompt(context) }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    const parsed = parseRecommendationPayload(text);
    return { provider: "gemini", ...parsed };
  }
}
