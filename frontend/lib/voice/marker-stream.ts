import "server-only";

/**
 * Split-safe parser that separates spoken text from inline map-command markers
 * in OpenClaw's streamed reply.
 *
 * The agent is instructed (via its system prompt) to emit a map intent as:
 *
 *     [[MAPCMD{"command":"show_routes","from":"...","to":"..."}MAPCMD]]
 *
 * before the spoken sentence. The marker must NEVER reach ElevenLabs TTS — the
 * adapter strips it from the spoken stream and turns it into an OpenAI
 * `tool_call`. Because the upstream stream is chunked, a marker can be split
 * across two pushes (the classic streaming-parser bug), so this parser holds a
 * tail that could be the start of a marker and only emits text it is certain is
 * outside a marker.
 *
 *   ┌─ "text" mode ──────────────┐        find START          ┌─ "inMarker" mode ─┐
 *   │ emit everything except a   │ ─────────────────────────▶ │ buffer until END, │
 *   │ possible partial START tail│ ◀───────────────────────── │ then parse → cmd  │
 *   └────────────────────────────┘        find END            └───────────────────┘
 */

export const MARKER_START = "[[MAPCMD";
export const MARKER_END = "MAPCMD]]";

export interface MapCommand {
  command: string;
  [key: string]: unknown;
}

export interface MarkerPushResult {
  /** Text safe to forward to TTS (marker-free). May be empty. */
  speech: string;
  /** Fully-parsed map commands found in this push. */
  commands: MapCommand[];
}

/** Longest k (< token.length) such that buffer ends with token.slice(0, k). */
function partialSuffixLen(buffer: string, token: string): number {
  const max = Math.min(buffer.length, token.length - 1);
  for (let k = max; k > 0; k--) {
    if (buffer.endsWith(token.slice(0, k))) return k;
  }
  return 0;
}

export class MarkerStreamParser {
  private buffer = "";
  private mode: "text" | "inMarker" = "text";

  push(chunk: string): MarkerPushResult {
    this.buffer += chunk;
    let speech = "";
    const commands: MapCommand[] = [];

    // Loop because one push may contain a full marker plus surrounding text.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.mode === "text") {
        const start = this.buffer.indexOf(MARKER_START);
        if (start >= 0) {
          speech += this.buffer.slice(0, start);
          this.buffer = this.buffer.slice(start + MARKER_START.length);
          this.mode = "inMarker";
          continue;
        }
        // No full START. Emit everything except a possible partial START tail.
        const hold = partialSuffixLen(this.buffer, MARKER_START);
        speech += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        break;
      }

      // inMarker: accumulate until END appears.
      const end = this.buffer.indexOf(MARKER_END);
      if (end >= 0) {
        const json = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + MARKER_END.length);
        this.mode = "text";
        const cmd = safeParseCommand(json);
        if (cmd) commands.push(cmd);
        continue;
      }
      // END not here yet — wait for more input, hold the whole buffer.
      break;
    }

    return { speech, commands };
  }

  /**
   * Call when the stream ends. In text mode any leftover is plain text. An
   * unterminated marker is dropped (never speak partial JSON aloud).
   */
  flush(): MarkerPushResult {
    if (this.mode === "text") {
      const speech = this.buffer;
      this.buffer = "";
      return { speech, commands: [] };
    }
    // Unterminated marker — discard it rather than leak JSON to speech.
    this.buffer = "";
    this.mode = "text";
    return { speech: "", commands: [] };
  }
}

function safeParseCommand(json: string): MapCommand | null {
  try {
    const parsed = JSON.parse(json.trim());
    if (parsed && typeof parsed === "object" && typeof parsed.command === "string") {
      return parsed as MapCommand;
    }
  } catch {
    // malformed marker — ignore, don't crash the stream
  }
  return null;
}
