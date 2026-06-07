export type { MobilityRecommendation, UserPreference, MobilityAgentContext } from "./types";
export { PROFILE_LABELS, PRIORITY_LABELS } from "./types";

export async function generateMobilityRecommendation(
  context: import("./types").MobilityAgentContext
): Promise<import("./types").MobilityRecommendation> {
  const res = await fetch("/api/agent/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Recommendation failed (${res.status})`);
  }

  return res.json() as Promise<import("./types").MobilityRecommendation>;
}
