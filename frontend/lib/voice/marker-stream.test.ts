import { describe, expect, it } from "vitest";
import { MarkerStreamParser, MARKER_START, MARKER_END } from "./marker-stream";

function feed(parser: MarkerStreamParser, chunks: string[]) {
  let speech = "";
  const commands = [];
  for (const c of chunks) {
    const r = parser.push(c);
    speech += r.speech;
    commands.push(...r.commands);
  }
  const f = parser.flush();
  speech += f.speech;
  commands.push(...f.commands);
  return { speech, commands };
}

const CMD = `{"command":"show_routes","from":"King's Cross","to":"Victoria"}`;
const MARKER = `${MARKER_START}${CMD}${MARKER_END}`;

describe("MarkerStreamParser", () => {
  it("passes through plain text with no markers", () => {
    const { speech, commands } = feed(new MarkerStreamParser(), ["Take the ", "step-free route."]);
    expect(speech).toBe("Take the step-free route.");
    expect(commands).toEqual([]);
  });

  it("extracts a marker delivered in one chunk and strips it from speech", () => {
    const { speech, commands } = feed(new MarkerStreamParser(), [`${MARKER} Here is your route.`]);
    expect(speech).toBe(" Here is your route.");
    expect(commands).toEqual([
      { command: "show_routes", from: "King's Cross", to: "Victoria" },
    ]);
  });

  // THE critical test: a marker split across streaming chunk boundaries must
  // never leak into spoken text.
  it("handles a marker split across many chunks (one char per chunk)", () => {
    const text = `Okay. ${MARKER} Routing now.`;
    const chunks = text.split(""); // worst case: 1 char per push
    const { speech, commands } = feed(new MarkerStreamParser(), chunks);
    expect(speech).toBe("Okay.  Routing now.");
    expect(speech).not.toContain("MAPCMD");
    expect(speech).not.toContain("show_routes");
    expect(commands).toEqual([
      { command: "show_routes", from: "King's Cross", to: "Victoria" },
    ]);
  });

  it("handles the START token split exactly down the middle", () => {
    const parser = new MarkerStreamParser();
    const a = parser.push("Go [[MAP");
    const b = parser.push(`CMD${CMD}${MARKER_END} done`);
    expect((a.speech + b.speech)).toBe("Go  done");
    expect(a.commands.length + b.commands.length).toBe(1);
    expect(a.speech).not.toContain("[[MAP");
  });

  it("handles two markers in a row", () => {
    const m2 = `${MARKER_START}{"command":"highlight_route","routeId":"A"}${MARKER_END}`;
    const { speech, commands } = feed(new MarkerStreamParser(), [`${MARKER}${m2}ok`]);
    expect(speech).toBe("ok");
    expect(commands).toEqual([
      { command: "show_routes", from: "King's Cross", to: "Victoria" },
      { command: "highlight_route", routeId: "A" },
    ]);
  });

  it("drops a malformed marker without crashing and keeps surrounding text", () => {
    const { speech, commands } = feed(new MarkerStreamParser(), [
      `before ${MARKER_START}{not json}${MARKER_END} after`,
    ]);
    expect(speech).toBe("before  after");
    expect(commands).toEqual([]);
  });

  it("does not speak an unterminated marker at end of stream", () => {
    const { speech, commands } = feed(new MarkerStreamParser(), [`hi ${MARKER_START}{"command":"show`]);
    expect(speech).toBe("hi ");
    expect(commands).toEqual([]);
  });

  it("does not prematurely emit text that turns out to be a real marker", () => {
    // A trailing partial-START must be held, not spoken, then resolved.
    const parser = new MarkerStreamParser();
    const a = parser.push("ready [["); // "[[" is a partial START prefix -> held
    expect(a.speech).toBe("ready ");
    const b = parser.push(`MAPCMD${CMD}${MARKER_END}!`);
    expect(b.speech).toBe("!");
    expect(b.commands).toHaveLength(1);
  });
});
