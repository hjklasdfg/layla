export function parseLlmJsonResponse<T>(rawText: string): T {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("LLM returned empty plan response");

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim()) as T;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }

  throw new Error(`Could not parse JSON from LLM output: ${trimmed.slice(0, 300)}`);
}
