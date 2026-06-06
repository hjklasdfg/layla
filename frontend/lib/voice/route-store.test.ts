import { describe, it, expect, beforeEach } from "vitest";
import { RouteStore } from "./route-store";
import type { RouteContext } from "./route-store";

const CTX: RouteContext = {
  sessionId: "s1",
  from: "Paddington",
  to: "Canary Wharf",
  routes: [{ id: "A", durationMinutes: 35, accessibilityScore: 88, stepFree: true, summary: "Elizabeth line" }],
  recommendation: "A",
  alerts: [],
};

beforeEach(() => {
  RouteStore.clear();
});

describe("RouteStore", () => {
  it("returns undefined for a session that has not been set", () => {
    expect(RouteStore.get("unknown")).toBeUndefined();
  });

  it("stores and retrieves a route context by session ID", () => {
    RouteStore.set("s1", CTX);
    const result = RouteStore.get("s1");
    expect(result?.from).toBe("Paddington");
    expect(result?.to).toBe("Canary Wharf");
    expect(result?.routes?.[0].id).toBe("A");
  });

  it("stamps lastUpdated when setting", () => {
    const before = Date.now();
    RouteStore.set("s1", CTX);
    const after = Date.now();
    const ts = RouteStore.get("s1")?.lastUpdated ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("overwrites an existing entry when set is called again", () => {
    RouteStore.set("s1", CTX);
    RouteStore.set("s1", { ...CTX, from: "Euston" });
    expect(RouteStore.get("s1")?.from).toBe("Euston");
  });

  it("removes a session after delete", () => {
    RouteStore.set("s1", CTX);
    RouteStore.delete("s1");
    expect(RouteStore.get("s1")).toBeUndefined();
  });

  it("isolates different sessions", () => {
    RouteStore.set("s1", { ...CTX, sessionId: "s1", from: "Euston" });
    RouteStore.set("s2", { ...CTX, sessionId: "s2", from: "Waterloo" });
    expect(RouteStore.get("s1")?.from).toBe("Euston");
    expect(RouteStore.get("s2")?.from).toBe("Waterloo");
  });
});
