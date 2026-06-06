import "server-only";

/**
 * Stream a reply directly from an OpenAI-compatible chat endpoint (e.g. the
 * local vLLM/llama model on :8000), bypassing the OpenClaw agent loop. Used for
 * the low-latency voice path: the agent loop adds tool-call overhead that pushes
 * first-spoken-token past ElevenLabs' 15s cap, while streaming straight from the
 * model gives first content in ~2s (simple) to ~10s (complex).
 *
 * Reasoning models stream their chain-of-thought as `delta.reasoning` /
 * `delta.reasoning_content`; we forward ONLY `delta.content` so thinking is
 * never spoken.
 *
 * CRITICAL for voice: this model is a reasoning build that thinks-before-speaks.
 * On a non-trivial turn the think phase can exceed 12s, during which it emits
 * only reasoning (which we strip) and ZERO spoken content — so ElevenLabs hits
 * its turn/cascade timeout and aborts with nothing spoken. We disable thinking
 * per-request via `chat_template_kwargs.enable_thinking=false`, which drops
 * first-spoken-token to ~1s. (reasoning_effort / reasoning_budget are ignored by
 * this llama-server build; only the chat_template_kwargs path works here.)
 */

export interface ModelMessage {
  role: string;
  content: string;
}

export interface StreamModelOptions {
  baseUrl: string;
  model: string;
  messages: ModelMessage[];
  maxTokens: number;
  onIncrement: (text: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function streamModelReply(opts: StreamModelOptions): Promise<void> {
  const { baseUrl, model, messages, maxTokens, onIncrement, signal, timeoutMs = 30_000 } = opts;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.4,
        stream: true,
        // Disable think-before-speak so first spoken token arrives in ~1s
        // instead of >12s (see file header). Honored by llama-server's chat
        // template; harmless to non-reasoning backends that ignore it.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`voice model error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const delta = JSON.parse(data)?.choices?.[0]?.delta;
          const content = delta?.content;
          if (typeof content === "string" && content) onIncrement(content); // never forward reasoning
        } catch {
          /* skip malformed SSE line */
        }
      }
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
