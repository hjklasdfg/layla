import type { EnrichedRoute } from "@/lib/accessibility/types";
import type { MobilitySensorPayload } from "@/lib/mobility/sensors";

export type UserProfile = "general" | "blind" | "wheelchair" | "elderly" | "custom";

export type UserPriority =
  | "fastest"
  | "least_stressful"
  | "most_accessible"
  | "most_reliable";

export interface UserPreference {
  profile: UserProfile;
  priority: UserPriority;
  customNotes?: string;
}

export type AgentProviderName =
  | "mock"
  | "openai"
  | "claude"
  | "gemini"
  | "nemotron"
  | "ollama"
  | "backend";

export interface MobilityRecommendation {
  provider: AgentProviderName;
  recommendedRouteId: string;
  routeComparison: string;
  tradeoffExplanation: string;
  finalRecommendation: string;
}

export interface MobilityAgentContext {
  routes: EnrichedRoute[];
  preference: UserPreference;
  journey: {
    start: string;
    destination: string;
  };
  sensors?: MobilitySensorPayload;
}

export interface AgentProvider {
  recommend(context: MobilityAgentContext): Promise<MobilityRecommendation>;
}

export const PROFILE_LABELS: Record<UserProfile, string> = {
  general: "General",
  blind: "Blind / Low vision",
  wheelchair: "Wheelchair user",
  elderly: "Elderly",
  custom: "Custom needs",
};

export const PRIORITY_LABELS: Record<UserPriority, string> = {
  fastest: "Fastest",
  least_stressful: "Least stressful",
  most_accessible: "Most accessible",
  most_reliable: "Most reliable",
};

export function formatRouteSummary(route: EnrichedRoute): string {
  const { signals } = route;
  return (
    `Route ${route.routeId}: ${route.etaMin} min — ` +
    `accessibility ${signals.accessibility}/100, ` +
    `stress ${signals.stress}/100, ` +
    `reliability ${signals.reliability}/100`
  );
}

export function buildRecommendationUserPrompt(context: MobilityAgentContext): string {
  const { routes, preference, journey } = context;
  const routeLines = routes.map(formatRouteSummary).join("\n");

  return [
    `Journey: ${journey.start} → ${journey.destination}`,
    `User profile: ${PROFILE_LABELS[preference.profile]}`,
    `Priority: ${PRIORITY_LABELS[preference.priority]}`,
    preference.customNotes ? `Custom notes: ${preference.customNotes}` : "",
    "",
    "Routes (Accessibility State Engine scores):",
    routeLines,
    "",
    "Respond with JSON only:",
    `{`,
    `  "recommendedRouteId": "A",`,
    `  "routeComparison": "...",`,
    `  "tradeoffExplanation": "...",`,
    `  "finalRecommendation": "..."`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const RECOMMENDATION_SYSTEM_PROMPT = `You are Layla, an accessibility-aware mobility advisor for London.
Compare routes using their Accessibility State Engine scores (accessibility, stress, reliability, predictability, crowding, crossing complexity).
Respect the user's profile and stated priority.
Use concise markdown bold (**text**) for route IDs and key metrics in string fields.
Return valid JSON only — no markdown fences.`;

export interface ParsedRecommendationPayload {
  recommendedRouteId: string;
  routeComparison: string;
  tradeoffExplanation: string;
  finalRecommendation: string;
}

export function parseRecommendationPayload(raw: string): ParsedRecommendationPayload {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? trimmed) as Partial<ParsedRecommendationPayload>;

  if (!parsed.recommendedRouteId || !parsed.routeComparison) {
    throw new Error("Agent response missing required recommendation fields");
  }

  return {
    recommendedRouteId: String(parsed.recommendedRouteId),
    routeComparison: String(parsed.routeComparison),
    tradeoffExplanation: String(parsed.tradeoffExplanation ?? ""),
    finalRecommendation: String(parsed.finalRecommendation ?? parsed.routeComparison),
  };
}
