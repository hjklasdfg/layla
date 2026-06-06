"use client";

import type { ReactNode } from "react";
import type { MobilityRecommendation } from "@/lib/agent";

interface MobilityAgentPanelProps {
  recommendation: MobilityRecommendation | null;
  loading: boolean;
  journeyLabel?: string;
  recommendationUpdated?: boolean;
}

function AgentSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="group">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-teal-500/10 text-teal-400">
          {icon}
        </span>
        <h3 className="text-xs font-medium tracking-wide text-slate-300">{title}</h3>
      </div>
      <div className="pl-7 text-[13.5px] leading-[1.65] text-slate-400">{children}</div>
    </section>
  );
}

function renderMarkdownBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-medium text-slate-200">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400/70"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <span className="text-sm text-slate-500">Analysing routes…</span>
    </div>
  );
}

const PROVIDER_LABELS: Record<MobilityRecommendation["provider"], string> = {
  mock: "Mock Agent",
  openai: "OpenAI",
  claude: "Claude",
  gemini: "Gemini",
  ollama: "Ollama",
};

export function MobilityAgentPanel({
  recommendation,
  loading,
  journeyLabel,
  recommendationUpdated,
}: MobilityAgentPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/50 bg-[#0c1017] shadow-xl shadow-black/20">
      {recommendationUpdated && !loading && (
        <div className="flex items-center gap-2 border-b border-teal-500/30 bg-teal-950/40 px-4 py-2 animate-[fadeIn_0.3s_ease-out]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-400" />
          <p className="text-xs font-medium text-teal-300">Recommendation Updated</p>
        </div>
      )}
      {/* Perplexity-style header bar */}
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 text-sm font-semibold text-slate-950">
            T
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Mobility Agent</p>
            <p className="text-[11px] text-slate-500">
              {journeyLabel ?? "Accessibility route advisor"}
            </p>
          </div>
        </div>
        {recommendation && !loading && (
          <span className="rounded-full border border-slate-700/60 bg-slate-800/50 px-2.5 py-0.5 font-mono text-[10px] text-slate-500">
            {PROVIDER_LABELS[recommendation.provider]}
          </span>
        )}
      </div>

      <div className="space-y-5 px-4 py-5">
        {loading && <ThinkingIndicator />}

        {!loading && recommendation && (
          <>
            <AgentSection
              title="Route comparison"
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 3h8v1H2V3zm0 2.5h5v1H2v-1zm0 2.5h6v1H2v-1z" />
                </svg>
              }
            >
              <p>{renderMarkdownBold(recommendation.routeComparison)}</p>
            </AgentSection>

            <div className="h-px bg-slate-800/80" />

            <AgentSection
              title="Trade-offs"
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 1L10 6H7v5H5V6H2L6 1z" />
                </svg>
              }
            >
              <p>{renderMarkdownBold(recommendation.tradeoffExplanation)}</p>
            </AgentSection>

            <div className="h-px bg-slate-800/80" />

            <AgentSection
              title="Recommendation"
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 1l1.5 3.5L11 5l-2.5 2.5.6 3.5L6 9.5 3.9 11l.6-3.5L2 5l3.5-.5L6 1z" />
                </svg>
              }
            >
              <p className="rounded-lg border border-teal-500/20 bg-teal-950/20 px-3 py-2.5 text-slate-300">
                {renderMarkdownBold(recommendation.finalRecommendation)}
              </p>
            </AgentSection>

            <div className="flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-800/60 px-2 py-1 text-[10px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                Route {recommendation.recommendedRouteId}
              </span>
              <span className="text-[10px] text-slate-600">
                Grounded in Accessibility State Engine scores
              </span>
            </div>
          </>
        )}

        {!loading && !recommendation && (
          <p className="text-sm text-slate-500">
            Compare routes to receive a personalised mobility recommendation.
          </p>
        )}
      </div>
    </div>
  );
}
