import { describe, it, expect } from "vitest";
import { verifyElevenLabsSignature } from "./auth";

const SECRET = "test-secret-key";
const BODY = '{"model":"nemoclaw","messages":[]}';

async function makeSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Buffer.from(sig).toString("hex");
}

describe("verifyElevenLabsSignature", () => {
  it("returns true for a valid HMAC signature", async () => {
    const sig = await makeSignature(BODY, SECRET);
    expect(await verifyElevenLabsSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("returns false when the body has been tampered with", async () => {
    const sig = await makeSignature(BODY, SECRET);
    const tamperedBody = BODY + " tampered";
    expect(await verifyElevenLabsSignature(tamperedBody, sig, SECRET)).toBe(false);
  });

  it("returns false when the signature header is null", async () => {
    expect(await verifyElevenLabsSignature(BODY, null, SECRET)).toBe(false);
  });

  it("returns false when the secret is empty", async () => {
    const sig = await makeSignature(BODY, SECRET);
    expect(await verifyElevenLabsSignature(BODY, sig, "")).toBe(false);
  });

  it("returns false for a completely wrong signature", async () => {
    expect(
      await verifyElevenLabsSignature(BODY, "badhash", SECRET)
    ).toBe(false);
  });
});
