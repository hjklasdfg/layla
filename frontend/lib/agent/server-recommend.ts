import "server-only";

import { rankRoutes } from "@/lib/recommendation";
import { serverEnv } from "@/lib/config/env";
import { BackendProvider } from "./providers/backend";
import { GeminiProvider } from "./providers/gemini";
import {
  formatRouteSummary,
  PRIORITY_LABELS,
  PROFILE_LABELS,
  type AgentProvider,
  type MobilityAgentContext,
  type MobilityRecommendation,
} from "./types";

class MockAgentProvider implements AgentProvider {
  async recommend(context: MobilityAgentContext): Promise<MobilityRecommendation> {
    const ranked = rankRoutes(context.routes, context.preference);
    const recommendedRouteId = ranked[0] ?? context.routes[0]?.routeId ?? "A";
    const recommended =
      context.routes.find((route) => route.routeId === recommendedRouteId) ??
      context.routes[0];

    if (!recommended) {
      throw new Error("No routes available for recommendation");
    }

    const others = context.routes.filter(
      (route) => route.routeId !== recommended.routeId
    );

    const routeComparison =
      [recommended, ...others]
        .map((route) => `- ${formatRouteSummary(route)}`)
        .join("\n") ||
      `Route ${recommended.routeId} is the only option.`;

    const tradeoffExplanation =
      `For **${PROFILE_LABELS[context.preference.profile]}** travellers prioritising **${PRIORITY_LABELS[context.preference.priority]}**, ` +
      `Route **${recommended.routeId}** balances ETA (${recommended.etaMin} min) with accessibility (${recommended.signals.accessibility}/100) ` +
      `and stress (${recommended.signals.stress}/100).`;

    const finalRecommendation =
      `Take **Route ${recommended.routeId}** — ${recommended.etaMin} min with accessibility score **${recommended.signals.accessibility}/100**.`;

    return {
      provider: "mock",
      recommendedRouteId: recommended.routeId,
      routeComparison,
      tradeoffExplanation,
      finalRecommendation,
    };
  }
}

function resolveProvider(): AgentProvider {
  const provider = serverEnv.llmProvider.toLowerCase();
  if (provider === "mock") {
    return new MockAgentProvider();
  }

  if (provider === "backend") {
    return serverEnv.backend.enabled ? new BackendProvider() : new MockAgentProvider();
  }

  if (provider === "gemini") {
    return serverEnv.gemini.enabled ? new GeminiProvider() : new MockAgentProvider();
  }

  if (serverEnv.backend.enabled) {
    return new BackendProvider();
  }

  if (serverEnv.gemini.enabled) {
    return new GeminiProvider();
  }

  return new MockAgentProvider();
}

export async function generateMobilityRecommendationServer(
  context: MobilityAgentContext
): Promise<MobilityRecommendation> {
  if (!context.routes.length) {
    throw new Error("At least one route is required");
  }

  const agent = resolveProvider();
  return agent.recommend(context);
}
