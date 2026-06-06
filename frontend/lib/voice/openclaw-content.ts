import "server-only";

/**
 * Helpers for OpenClaw gateway chat message content.
 *
 * OpenClaw streams assistant messages over the gateway WebSocket as:
 *   { role:"assistant", content: [ { type:"text", text:"..." }, ... ] }
 * A *reasoning* model (Nemotron reasoning) additionally emits chain-of-thought
 * parts — they arrive as parts that are NOT plain text (e.g. `type:"thinking"`
 * or carrying a `thinking` field). Those MUST NOT be spoken aloud, so
 * `speakableText` drops them.
 *
 * Delta events carry the CUMULATIVE text so far (verified against the live
 * gateway: "PING" -> "PING-OK"), so `extractIncrement` returns only the newly
 * appended suffix for OpenAI-style incremental SSE deltas.
 */

export interface ContentPart {
  type?: string;
  text?: unknown;
  thinking?: unknown;
}

export type MessageContent = string | ContentPart[] | null | undefined;

/** A part is speakable iff it is a plain text part (never reasoning/thinking). */
function isSpeakablePart(part: ContentPart): boolean {
  if (!part || typeof part !== "object") return false;
  if (typeof part.thinking === "string") return false; // reasoning carrier
  if (part.type === "thinking" || part.type === "reasoning") return false;
  return typeof part.text === "string";
}

/**
 * Extract only the spoken text from an OpenClaw message content, dropping any
 * reasoning/thinking parts so the agent never speaks its chain-of-thought.
 */
export function speakableText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isSpeakablePart)
    .map((part) => part.text as string)
    .join("");
}

/** Pull the content out of a gateway chat event's `message` field. */
export function speakableTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as { text?: unknown; content?: MessageContent };
  if (typeof record.text === "string") return record.text;
  return speakableText(record.content);
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Given the previously seen cumulative text and the new cumulative text,
 * return only the newly appended portion. In the normal case `prev` is a
 * prefix of `next` and this is `next.slice(prev.length)`. If the stream
 * rewrote earlier text (rare), we fall back to the suffix after the longest
 * common prefix so we never replay already-spoken words.
 */
export function extractIncrement(prev: string, next: string): string {
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return next.slice(commonPrefixLength(prev, next));
}
