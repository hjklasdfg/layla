import { describe, expect, it } from "vitest";
import {
  roleFrame,
  contentFrame,
  toolCallFrame,
  finishFrames,
  errorFrame,
} from "./openai-sse";

const meta = { id: "chatcmpl-test", model: "nemotron", created: 1700000000 };

function parseData(frame: string) {
  // frames look like: "data: {json}\n\n"  (errorFrame/finishFrames append DONE)
  return frame
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length))
    .map((s) => (s === "[DONE]" ? "[DONE]" : JSON.parse(s)));
}

describe("openai-sse frames", () => {
  it("roleFrame opens with assistant role", () => {
    const [chunk] = parseData(roleFrame(meta));
    expect(chunk.choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunk.object).toBe("chat.completion.chunk");
  });

  it("contentFrame carries spoken text", () => {
    const [chunk] = parseData(contentFrame(meta, "Take Route C."));
    expect(chunk.choices[0].delta.content).toBe("Take Route C.");
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("contentFrame returns empty string for empty content", () => {
    expect(contentFrame(meta, "")).toBe("");
  });

  it("toolCallFrame emits an OpenAI tool_call with command name + JSON args", () => {
    const [chunk] = parseData(
      toolCallFrame(meta, { command: "show_routes", from: "A", to: "B" }, 0),
    );
    const tc = chunk.choices[0].delta.tool_calls[0];
    expect(tc.type).toBe("function");
    expect(tc.function.name).toBe("show_routes");
    expect(JSON.parse(tc.function.arguments)).toEqual({ from: "A", to: "B" });
    expect(tc.index).toBe(0);
  });

  it("finishFrames ends with finish_reason then [DONE]", () => {
    const frames = parseData(finishFrames(meta, "stop"));
    expect(frames[0].choices[0].finish_reason).toBe("stop");
    expect(frames[1]).toBe("[DONE]");
  });

  it("errorFrame surfaces a message then closes the stream", () => {
    const frames = parseData(errorFrame(meta, "Inference unavailable"));
    expect(frames[0].choices[0].delta.content).toBe("Inference unavailable");
    expect(frames[0].choices[0].finish_reason).toBe("stop");
    expect(frames[1]).toBe("[DONE]");
  });
});
