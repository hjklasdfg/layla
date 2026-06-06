import { describe, expect, it } from "vitest";
import {
  extractLatestUserText,
  bearerOk,
  resolveSessionId,
  openClawSessionKey,
  buildOpenClawMessage,
  readCookie,
} from "./voice-chat-helpers";

describe("extractLatestUserText", () => {
  it("returns the last user message text", () => {
    expect(
      extractLatestUserText([
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ]),
    ).toBe("second");
  });
  it("flattens content-part arrays", () => {
    expect(
      extractLatestUserText([{ role: "user", content: [{ type: "text", text: "hello there" }] }]),
    ).toBe("hello there");
  });
  it("ignores trailing assistant/system messages", () => {
    expect(
      extractLatestUserText([
        { role: "user", content: "take me to Victoria" },
        { role: "assistant", content: "ok" },
      ]),
    ).toBe("take me to Victoria");
  });
  it("returns empty for no user message or bad input", () => {
    expect(extractLatestUserText([{ role: "system", content: "x" }])).toBe("");
    expect(extractLatestUserText(undefined)).toBe("");
  });
});

describe("bearerOk", () => {
  it("allows when no secret configured (dev)", () => {
    expect(bearerOk(null, "")).toBe(true);
  });
  it("accepts a matching Bearer token", () => {
    expect(bearerOk("Bearer s3cret", "s3cret")).toBe(true);
  });
  it("accepts a bare token too", () => {
    expect(bearerOk("s3cret", "s3cret")).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(bearerOk("Bearer nope", "s3cret")).toBe(false);
  });
  it("rejects a missing header when secret set", () => {
    expect(bearerOk(null, "s3cret")).toBe(false);
  });
});

describe("resolveSessionId", () => {
  it("prefers header, then body user, then cookie, then default", () => {
    expect(resolveSessionId({ headerSessionId: "h", bodyUser: "b", cookieSessionId: "c" })).toBe("h");
    expect(resolveSessionId({ headerSessionId: null, bodyUser: "b", cookieSessionId: "c" })).toBe("b");
    expect(resolveSessionId({ headerSessionId: "  ", bodyUser: null, cookieSessionId: "c" })).toBe("c");
    expect(resolveSessionId({})).toBe("default");
  });
});

describe("openClawSessionKey", () => {
  it("namespaces the session id", () => {
    expect(openClawSessionKey("abc")).toBe("layla-voice-abc");
  });
});

describe("buildOpenClawMessage", () => {
  it("prefixes route context when present", () => {
    const msg = buildOpenClawMessage("where to?", "From: A -> To: B");
    expect(msg).toContain("[Current map context]");
    expect(msg).toContain("From: A -> To: B");
    expect(msg.endsWith("where to?")).toBe(true);
  });
  it("omits context block when there is no active route", () => {
    expect(buildOpenClawMessage("hi", "No active route on the map yet.")).toBe("hi");
  });
});

describe("readCookie", () => {
  it("reads a named cookie", () => {
    expect(readCookie("a=1; session_id=xyz; b=2", "session_id")).toBe("xyz");
  });
  it("returns null when absent", () => {
    expect(readCookie("a=1", "session_id")).toBeNull();
    expect(readCookie(null, "session_id")).toBeNull();
  });
});
