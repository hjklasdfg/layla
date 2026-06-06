import "server-only";

import { serverEnv } from "@/lib/config/env";
import { parseLlmJsonResponse } from "@/lib/mobility/llm-json";

interface NemotronMessage {
  content?: string | null;
  reasoning?: string | null;
}

function extractMessageText(message: NemotronMessage | undefined): string | null {
  const content = message?.content?.trim();
  if (content) return content;

  const reasoning = message?.reasoning?.trim();
  if (!reasoning) return null;

  if (reasoning.includes("{")) {
    try {
      parseLlmJsonResponse<unknown>(reasoning);
      return reasoning;
    } catch {
      // fall through
    }
  }

  return null;
}

export async function callNemotronJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<{ parsed: T; reasoning?: string }> {
  if (!serverEnv.nemotron.enabled) {
    throw new Error("NEMOTRON_BASE_URL not configured");
  }

  const baseUrl = serverEnv.nemotron.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;
  const maxTokens = options?.maxTokens ?? 8192;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (serverEnv.nemotron.apiKey) {
    headers.Authorization = `Bearer ${serverEnv.nemotron.apiKey}`;
  }

  let lastFinishReason: string | undefined;

  for (const attempt of [maxTokens, Math.min(maxTokens * 2, 16384)]) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: serverEnv.nemotron.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.3,
        max_tokens: attempt,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Nemotron error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: NemotronMessage;
      }>;
    };

    const choice = data.choices?.[0];
    lastFinishReason = choice?.finish_reason;
    const text = extractMessageText(choice?.message);

    if (text) {
      return {
        parsed: parseLlmJsonResponse<T>(text),
        reasoning: choice?.message?.reasoning?.trim() || undefined,
      };
    }

    if (choice?.finish_reason !== "length") break;
  }

  throw new Error(
    `Nemotron returned empty response${lastFinishReason ? ` (finish: ${lastFinishReason})` : ""}`
  );
}
