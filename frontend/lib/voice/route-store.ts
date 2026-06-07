import "server-only";

/**
 * Server-side route-context store. The voice agent (OpenClaw) doesn't know
 * about TfL/OSM routes, so the latest mobility-plan result is stashed here per
 * session and injected into the agent's prompt on each voice turn.
 *
 * In-memory Map: correct on a single long-lived host (this DGX runs one
 * `next start` process). If the app is ever scaled to multiple workers/hosts,
 * swap this for a shared KV — the call sites don't change.
 */

export interface RouteContextRoute {
  id: string;
  durationMinutes?: number;
  accessibilityScore?: number;
  stepFree?: boolean;
  summary?: string;
}

export interface RouteContext {
  from?: string;
  to?: string;
  routes?: RouteContextRoute[];
  recommendation?: string;
  alerts?: string[];
  lastUpdated: number;
}

const store = new Map<string, RouteContext>();

export function setRouteContext(sessionId: string, ctx: Omit<RouteContext, "lastUpdated">): void {
  if (!sessionId) return;
  store.set(sessionId, { ...ctx, lastUpdated: Date.now() });
}

export function getRouteContext(sessionId: string): RouteContext | null {
  return store.get(sessionId) ?? null;
}

export function clearRouteContext(sessionId: string): void {
  store.delete(sessionId);
}

/** Render a compact, speakable-context block for the agent prompt. */
export function formatRouteContext(ctx: RouteContext | null): string {
  if (!ctx || (!ctx.from && !ctx.to && !ctx.routes?.length)) {
    return "No active route on the map yet.";
  }
  const lines: string[] = [];
  if (ctx.from || ctx.to) lines.push(`From: ${ctx.from ?? "?"} -> To: ${ctx.to ?? "?"}`);
  if (ctx.routes?.length) {
    lines.push("Routes available:");
    for (const r of ctx.routes) {
      const bits = [
        `Route ${r.id}`,
        r.durationMinutes != null ? `${r.durationMinutes} min` : null,
        r.stepFree != null ? (r.stepFree ? "step-free" : "has steps") : null,
        r.accessibilityScore != null ? `accessibility ${r.accessibilityScore}/100` : null,
        r.summary || null,
      ].filter(Boolean);
      lines.push(`  ${bits.join(", ")}`);
    }
  }
  if (ctx.recommendation) lines.push(`Current recommendation: Route ${ctx.recommendation}`);
  if (ctx.alerts?.length) lines.push(`Alerts: ${ctx.alerts.join("; ")}`);
  return lines.join("\n");
}
