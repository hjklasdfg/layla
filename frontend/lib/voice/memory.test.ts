import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadMemory, appendFacts } from "./memory";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "voice-memory-test-"));
  process.env.VOICE_MEMORY_DIR = dir;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.VOICE_MEMORY_DIR;
});

describe("loadMemory", () => {
  it("returns empty string when no memory file exists", async () => {
    const result = await loadMemory("session-missing");
    expect(result).toBe("");
  });

  it("returns the file contents when the memory file exists", async () => {
    const { writeFile } = await import("fs/promises");
    await writeFile(join(dir, "memory-session-abc.md"), "# User Memory\n\n- Wheelchair user");
    const result = await loadMemory("session-abc");
    expect(result).toBe("# User Memory\n\n- Wheelchair user");
  });
});

describe("appendFacts", () => {
  it("creates the memory file with correct structure when it does not exist", async () => {
    await appendFacts("session-new", ["Mobility: wheelchair user", "Avoids: stairs"]);
    const contents = await loadMemory("session-new");
    expect(contents).toContain("# User Memory");
    expect(contents).toContain("Mobility: wheelchair user");
    expect(contents).toContain("Avoids: stairs");
  });

  it("appends new facts to an existing file without overwriting existing content", async () => {
    await appendFacts("session-existing", ["Mobility: blind"]);
    await appendFacts("session-existing", ["Prefers: step-free routes"]);
    const contents = await loadMemory("session-existing");
    expect(contents).toContain("Mobility: blind");
    expect(contents).toContain("Prefers: step-free routes");
  });

  it("does not duplicate facts already present in memory", async () => {
    await appendFacts("session-dedup", ["Mobility: elderly"]);
    await appendFacts("session-dedup", ["Mobility: elderly"]);
    const contents = await loadMemory("session-dedup");
    const occurrences = (contents.match(/Mobility: elderly/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("does nothing when the facts array is empty", async () => {
    await appendFacts("session-empty", []);
    const contents = await loadMemory("session-empty");
    expect(contents).toBe("");
  });
});
