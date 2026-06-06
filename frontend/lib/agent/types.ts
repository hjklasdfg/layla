import type { EnrichedRoute } from "@/lib/accessibility/types";

export type Profile = "general" | "wheelchair" | "blind" | "elderly" | "custom";
export type Priority = "fastest" | "least_stressful" | "most_accessible" | "most_reliable";

export interface UserPreference {
  profile: Profile;
  priority: Priority;
  customNotes?: string;
}

export interface MobilityAgentContext {
  routes: EnrichedRoute[];
  preference: UserPreference;
  journey: { start: string; destination: string };
}

export interface MobilityRecommendation {
  recommendedRouteId: string;
  reason: string;
  warnings: string[];
}

export interface AgentProvider {
  recommend(context: MobilityAgentContext): Promise<MobilityRecommendation>;
}

export const PROFILE_LABELS: Record<Profile, string> = {
  general: "General",
  wheelchair: "Wheelchair",
  blind: "Visually Impaired",
  elderly: "Elderly",
  custom: "Custom",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  fastest: "Fastest",
  least_stressful: "Least Stressful",
  most_accessible: "Most Accessible",
  most_reliable: "Most Reliable",
};
