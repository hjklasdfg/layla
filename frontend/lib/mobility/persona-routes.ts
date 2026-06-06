import type { EnrichedRoute } from "@/lib/accessibility/types";
import {
  PROFILE_LABELS,
  type UserPreference,
  type UserProfile,
} from "@/lib/agent/types";
import { rankRoutes } from "@/lib/recommendation";

export interface PersonaRoutePick {
  profile: UserProfile;
  label: string;
  routeId: string;
  color: string;
  dashArray?: string;
}

export const PERSONA_ROUTE_COLORS: Record<UserProfile, string> = {
  general: "#22d3ee",
  blind: "#fbbf24",
  wheelchair: "#34d399",
  elderly: "#a78bfa",
  sensitive: "#f472b6",
  tourist: "#38bdf8",
  custom: "#fb923c",
};

const PERSONA_DASH: Partial<Record<UserProfile, string>> = {
  blind: "10 8",
  elderly: "6 6",
  sensitive: "4 6",
  tourist: "12 6 3 6",
};

/** Best route ID per selected persona (local ranking — no extra API calls). */
export function computePersonaRoutePicks(
  routes: EnrichedRoute[],
  profiles: UserProfile[],
  priority: UserPreference["priority"]
): PersonaRoutePick[] {
  if (!routes.length || !profiles.length) return [];

  return profiles.map((profile) => {
    const ranked = rankRoutes(routes, { profile, priority });
    const routeId = ranked[0] ?? routes[0]!.routeId;
    return {
      profile,
      label: PROFILE_LABELS[profile],
      routeId,
      color: PERSONA_ROUTE_COLORS[profile],
      dashArray: PERSONA_DASH[profile],
    };
  });
}
