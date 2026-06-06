import { describe, expect, it } from "vitest";
import { POST } from "./route";

// End-to-end test of the /api/voice/chat adapter against a live OpenClaw
// gateway. Skipped unless OPENCLAW_LIVE=1.
//   OPENCLAW_LIVE=1 OPENCLAW_GATEWAY_TOKEN=... npx vitest run app/api/voice/chat/route.integration.test.ts
const LIVE = process.env.OPENCLAW_LIVE === "1";

async function readSse(res: Response): Promise<{ content: string; toolCalls: unknown[] }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolCalls: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      const m = trimmed.startsWith("data: ") ? [trimmed, trimmed.slice(6)] : null;
      if (!m || m[1] === "[DONE]") continue;
      const chunk = JSON.parse(m[1]);
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === "string") content += delta.content;
      if (Array.isArray(delta.tool_calls)) toolCalls.push(...delta.tool_calls);
    }
  }
  return { content, toolCalls };
}

describe("POST /api/voice/chat (live gateway)", () => {
  it("returns 401 without the bearer secret when one is configured", async () => {
    if (!process.env.VOICE_CHAT_SECRET) return; // only meaningful when set
    const res = await POST(
      new Request("http://local/api/voice/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when there is no user message", async () => {
    const res = await POST(
      new Request("http://local/api/voice/chat", {
        method: "POST",
        headers: process.env.VOICE_CHAT_SECRET
          ? { authorization: `Bearer ${process.env.VOICE_CHAT_SECRET}` }
          : {},
        body: JSON.stringify({ messages: [{ role: "assistant", content: "x" }] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it.runIf(LIVE)(
    "streams a spoken reply from the agent as well-formed OpenAI SSE",
    async () => {
      const res = await POST(
        new Request("http://local/api/voice/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.VOICE_CHAT_SECRET
              ? { authorization: `Bearer ${process.env.VOICE_CHAT_SECRET}` }
              : {}),
            "x-session-id": `route-itest-${Date.now()}`,
          },
          body: JSON.stringify({
            stream: true,
            messages: [{ role: "user", content: "Say hello in one short sentence." }],
          }),
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const { content } = await readSse(res);
      // Adapter contract: spoken text streamed, reasoning + markers never leak.
      expect(content.trim().length).toBeGreaterThan(0);
      expect(content).not.toContain("MAPCMD");
      expect(content.toLowerCase()).not.toContain("<think");
    },
    130_000,
  );
});
