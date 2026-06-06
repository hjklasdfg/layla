import "server-only";

import { serverEnv } from "@/lib/config/env";
import { parseLlmJsonResponse } from "@/lib/mobility/llm-json";

export async function callNebiusJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<{ parsed: T; rawText: string }> {
  if (!serverEnv.nebiusai.enabled) {
    throw new Error("NEBUISAI_API_KEY not configured");
  }

  const baseUrl = serverEnv.nebiusai.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverEnv.nebiusai.apiKey}`,
    },
    body: JSON.stringify({
      model: serverEnv.nebiusai.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Nebius AI error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Nebius AI returned empty response");

  return { parsed: parseLlmJsonResponse<T>(text), rawText: text };
}

/** Vision + JSON — hazard photo analysis via Nebius multimodal models. */
export async function callNebiusVisionJson<T>(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<{ parsed: T; rawText: string }> {
  if (!serverEnv.nebiusai.enabled) {
    throw new Error("NEBUISAI_API_KEY not configured");
  }

  const baseUrl = serverEnv.nebiusai.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serverEnv.nebiusai.apiKey}`,
    },
    body: JSON.stringify({
      model: serverEnv.nebiusai.visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 2048,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Nebius AI vision error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Nebius AI vision returned empty response");

  return { parsed: parseLlmJsonResponse<T>(text), rawText: text };
}
