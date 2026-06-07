import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Pure helpers for the /api/voice/chat adapter — isolated from I/O so they can
 * be unit tested without the gateway or a live request.
 */

export interface OpenAIMessage {
  role?: string;
  content?: unknown;
}

/** Flatten OpenAI message content (string or content-part array) to text. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Extract ONLY the latest user turn. We forward just this to OpenClaw — the
 * agent owns conversation memory, so replaying ElevenLabs' full history would
 * double the context (Codex #4 / decision: latest-user-turn only).
 */
export function extractLatestUserText(messages: OpenAIMessage[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messageText(messages[i].content).trim();
  }
  return "";
}

/** Constant-time bearer check. Empty secret = auth disabled (dev only). */
export function bearerOk(authHeader: string | null, secret: string): boolean {
  if (!secret) return true; // auth not configured
  if (!authHeader) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = m ? m[1] : authHeader.trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Resolve a stable session id from the request signals, in priority order:
 * explicit header, OpenAI `user` body field, cookie, then a single-user default.
 */
export function resolveSessionId(opts: {
  headerSessionId?: string | null;
  bodyUser?: string | null;
  cookieSessionId?: string | null;
}): string {
  return (
    (opts.headerSessionId && opts.headerSessionId.trim()) ||
    (opts.bodyUser && String(opts.bodyUser).trim()) ||
    (opts.cookieSessionId && opts.cookieSessionId.trim()) ||
    "default"
  );
}

/** Map a session id to the OpenClaw gateway sessionKey namespace. */
export function openClawSessionKey(sessionId: string): string {
  return `layla-voice-${sessionId}`;
}

/** Compose the single message sent to OpenClaw, prefixing route context if any. */
export function buildOpenClawMessage(userText: string, routeContextText: string): string {
  const ctx = routeContextText && routeContextText !== "No active route on the map yet."
    ? `[Current map context]\n${routeContextText}\n\n`
    : "";
  return `${ctx}${userText}`;
}

/** Read a cookie value from a Cookie header. */
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
