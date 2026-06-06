"use client";

import { useState } from "react";
import type { LlmPlanInput } from "@/lib/mobility/llm-plan-prompt";

export interface ClientPlanPreview {
  trigger: "voice" | "form";
  audioInput?: string;
  journey?: { start?: string; destination?: string };
  preference: {
    profile: string;
    priority: string;
    customNotes?: string;
  };
}

interface GeminiInputPanelProps {
  loading?: boolean;
  clientPreview?: ClientPlanPreview | null;
  llmInput?: LlmPlanInput | null;
  /** @deprecated use llmInput */
  geminiInput?: LlmPlanInput | null;
}

export function GeminiInputPanel({
  loading,
  clientPreview,
  llmInput: llmInputProp,
  geminiInput,
}: GeminiInputPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const llmInput = llmInputProp ?? geminiInput ?? null;

  if (!loading && !clientPreview && !llmInput) return null;

  const display = llmInput ?? clientPreview;

  return (
    <div className="overflow-hidden rounded-xl border border-violet-500/30 bg-violet-950/15">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-violet-300">
          LLM input
        </span>
        <span className="font-mono text-[10px] text-violet-400/80">
          {loading ? "calling…" : llmInput ? "sent" : "preview"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-violet-500/20 px-3 py-2">
          {loading && (
            <p className="text-xs text-violet-200/80">
              Planning route — fetching TfL routes, then sending payload below.
            </p>
          )}

          {clientPreview && !llmInput && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-400/70">
                Client trigger
              </p>
              <pre className="max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-violet-100/90">
                {JSON.stringify(clientPreview, null, 2)}
              </pre>
            </div>
          )}

          {llmInput && (
            <>
              <p className="text-[10px] text-violet-300/70">
                Model: <span className="font-mono">{llmInput.model}</span>
                {" · "}
                {llmInput.request.tflJourney.candidates.length} TfL candidate
                {llmInput.request.tflJourney.candidates.length !== 1 ? "s" : ""}
                {" · "}
                {llmInput.userPrompt.length.toLocaleString()} chars
              </p>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-400/70">
                  Request summary
                </p>
                <pre className="max-h-40 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-violet-100/90">
                  {JSON.stringify(
                    {
                      audioInput: llmInput.request.audioInput,
                      journey: llmInput.request.journey,
                      preference: llmInput.request.preference,
                      tflJourney: {
                        from: llmInput.request.tflJourney.from,
                        to: llmInput.request.tflJourney.to,
                        candidateIds: llmInput.request.tflJourney.candidates.map(
                          (c) => c.id
                        ),
                      },
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-400/70">
                  System prompt
                </p>
                <pre className="max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-violet-100/90 whitespace-pre-wrap">
                  {llmInput.systemPrompt}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-400/70">
                  User prompt (full POST body — large TfL raw data)
                </p>
                <pre className="max-h-64 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-violet-100/90 whitespace-pre-wrap">
                  {llmInput.userPrompt.length > 12000
                    ? `${llmInput.userPrompt.slice(0, 12000)}\n\n… truncated (${llmInput.userPrompt.length.toLocaleString()} chars total — scroll in devtools Network tab for full payload)`
                    : llmInput.userPrompt}
                </pre>
              </div>
            </>
          )}

          {!display && loading && (
            <p className="text-xs text-slate-500">Waiting for plan request…</p>
          )}
        </div>
      )}
    </div>
  );
}
