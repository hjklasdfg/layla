import "server-only";

/**
 * Builders for OpenAI-compatible Chat Completions *streaming* frames.
 *
 * ElevenLabs Conversational AI's Custom-LLM expects our /api/voice/chat to
 * speak this exact wire format: a sequence of `data: {chunk}\n\n` lines
 * terminated by `data: [DONE]\n\n`. Spoken text rides in `choices[0].delta.content`;
 * map actions ride in `choices[0].delta.tool_calls` (which ElevenLabs turns into
 * a browser client-tool invocation).
 */

import type { MapCommand } from "./marker-stream";

export interface SseFrameMeta {
  id: string;
  model: string;
  created: number;
}

function frame(meta: SseFrameMeta, delta: Record<string, unknown>, finishReason: string | null): string {
  const payload = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Opening frame establishing the assistant role. */
export function roleFrame(meta: SseFrameMeta): string {
  return frame(meta, { role: "assistant", content: "" }, null);
}

/** A spoken-text delta. Returns "" for empty text so callers can skip it. */
export function contentFrame(meta: SseFrameMeta, content: string): string {
  if (!content) return "";
  return frame(meta, { content }, null);
}

/**
 * A tool-call frame for a map command. ElevenLabs fires the registered client
 * tool named after `command` with the remaining fields as JSON arguments.
 */
export function toolCallFrame(meta: SseFrameMeta, cmd: MapCommand, index: number): string {
  const { command, ...args } = cmd;
  return frame(
    meta,
    {
      tool_calls: [
        {
          index,
          id: `${meta.id}-tool-${index}`,
          type: "function",
          function: { name: command, arguments: JSON.stringify(args) },
        },
      ],
    },
    null,
  );
}

/** Terminal frame with a finish reason, then the [DONE] sentinel. */
export function finishFrames(meta: SseFrameMeta, reason: "stop" | "tool_calls" | "length" = "stop"): string {
  return frame(meta, {}, reason) + "data: [DONE]\n\n";
}

/** Standalone [DONE] (e.g. after an error already wrote a final frame). */
export function doneFrame(): string {
  return "data: [DONE]\n\n";
}

/** A non-streaming-style error surfaced inside the SSE channel. */
export function errorFrame(meta: SseFrameMeta, message: string): string {
  return frame(meta, { content: message }, "stop") + "data: [DONE]\n\n";
}
