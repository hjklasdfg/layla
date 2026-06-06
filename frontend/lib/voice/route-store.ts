export interface RouteContext {
  sessionId: string;
  from?: string;
  to?: string;
  routes?: Array<{
    id: string;
    durationMinutes: number;
    accessibilityScore: number;
    stepFree: boolean;
    summary: string;
  }>;
  recommendation?: string;
  alerts?: string[];
  lastUpdated?: number;
}

const store = new Map<string, RouteContext>();

export const RouteStore = {
  get(sessionId: string): RouteContext | undefined {
    return store.get(sessionId);
  },
  set(sessionId: string, ctx: RouteContext): void {
    store.set(sessionId, { ...ctx, lastUpdated: Date.now() });
  },
  delete(sessionId: string): void {
    store.delete(sessionId);
  },
  clear(): void {
    store.clear();
  },
};
