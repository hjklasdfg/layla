import { describe, it, expect } from "vitest";
import { buildSystemPrompt, formatRouteContext } from "./context-builder";
import type { RouteContext } from "./route-store";

const FULL_CONTEXT: RouteContext = {
  sessionId: "s1",
  from: "King's Cross St. Pancras",
  to: "Victoria",
  routes: [
    {
      id: "A",
      durationMinutes: 28,
      accessibilityScore: 94,
      stepFree: true,
      summary: "Step-free throughout",
    },
    {
      id: "B",
      durationMinutes: 22,
      accessibilityScore: 81,
      stepFree: false,
      summary: "1 step at Green Park",
    },
  ],
  recommendation: "A",
  alerts: ["Circle line minor delays"],
  lastUpdated: 1_700_000_000,
};

describe("formatRouteContext", () => {
  it("formats a full route context with all fields", () => {
    const text = formatRouteContext(FULL_CONTEXT);
    expect(text).toContain("King's Cross St. Pancras");
    expect(text).toContain("Victoria");
    expect(text).toContain("Route A");
    expect(text).toContain("28 min");
    expect(text).toContain("94/100");
    expect(text).toContain("step-free");
    expect(text).toContain("Route B");
    expect(text).toContain("Circle line minor delays");
    expect(text).toContain("Route A");
  });

  it("shows 'No active route' when from/to are missing", () => {
    const text = formatRouteContext({ sessionId: "s1" });
    expect(text).toContain("No active route");
  });

  it("includes live alerts when present", () => {
    const text = formatRouteContext({ ...FULL_CONTEXT, alerts: ["Severe delays on Jubilee line"] });
    expect(text).toContain("Severe delays on Jubilee line");
  });
});

describe("buildSystemPrompt", () => {
  it("includes <memory> block when memory is provided", () => {
    const prompt = buildSystemPrompt("- Mobility: wheelchair user", null);
    expect(prompt).toContain("<memory>");
    expect(prompt).toContain("wheelchair user");
    expect(prompt).toContain("</memory>");
  });

  it("omits <memory> block when memory string is empty", () => {
    const prompt = buildSystemPrompt("", null);
    expect(prompt).not.toContain("<memory>");
  });

  it("includes <current-map> block when route context is provided", () => {
    const prompt = buildSystemPrompt("", FULL_CONTEXT);
    expect(prompt).toContain("<current-map>");
    expect(prompt).toContain("King's Cross St. Pancras");
    expect(prompt).toContain("</current-map>");
  });

  it("omits <current-map> block when route context is null", () => {
    const prompt = buildSystemPrompt("", null);
    expect(prompt).not.toContain("<current-map>");
  });

  it("always includes the voice persona and map command instructions", () => {
    const prompt = buildSystemPrompt("", null);
    expect(prompt).toContain("TongSense");
    expect(prompt).toContain("map_command");
  });

  it("includes both memory and route context when both are provided", () => {
    const prompt = buildSystemPrompt("- Mobility: blind", FULL_CONTEXT);
    expect(prompt).toContain("<memory>");
    expect(prompt).toContain("<current-map>");
  });
});
