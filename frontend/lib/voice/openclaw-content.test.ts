import { describe, expect, it } from "vitest";
import { speakableText, speakableTextFromMessage, extractIncrement } from "./openclaw-content";

describe("speakableText", () => {
  it("returns a plain string content as-is", () => {
    expect(speakableText("hello")).toBe("hello");
  });

  it("joins text parts", () => {
    expect(
      speakableText([
        { type: "text", text: "Take " },
        { type: "text", text: "Route C." },
      ]),
    ).toBe("Take Route C.");
  });

  it("drops reasoning parts carried as type:thinking", () => {
    expect(
      speakableText([
        { type: "thinking", text: "the user wants step-free, compare A vs C" },
        { type: "text", text: "Route C is fully step-free." },
      ]),
    ).toBe("Route C is fully step-free.");
  });

  it("drops parts that carry a `thinking` field", () => {
    expect(
      speakableText([
        { thinking: "internal cot..." },
        { type: "text", text: "Spoken." },
      ]),
    ).toBe("Spoken.");
  });

  it("returns empty for non-array, non-string content", () => {
    expect(speakableText(null)).toBe("");
    expect(speakableText(undefined)).toBe("");
  });
});

describe("speakableTextFromMessage", () => {
  it("reads message.text when present", () => {
    expect(speakableTextFromMessage({ text: "hi" })).toBe("hi");
  });
  it("reads message.content array and strips thinking", () => {
    expect(
      speakableTextFromMessage({
        role: "assistant",
        content: [
          { type: "thinking", text: "cot" },
          { type: "text", text: "answer" },
        ],
      }),
    ).toBe("answer");
  });
});

describe("extractIncrement (cumulative deltas -> incremental)", () => {
  it("returns the new suffix when prev is a prefix of next", () => {
    expect(extractIncrement("PING", "PING-OK")).toBe("-OK");
  });
  it("returns full text when prev is empty", () => {
    expect(extractIncrement("", "PING")).toBe("PING");
  });
  it("returns empty when nothing new", () => {
    expect(extractIncrement("done", "done")).toBe("");
  });
  it("falls back to suffix-after-common-prefix on a rewrite", () => {
    // prev not a prefix of next -> emit only the diverging tail
    expect(extractIncrement("Route A", "Route C")).toBe("C");
  });
});
