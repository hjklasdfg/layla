"use client";

import type { CVObservation } from "@/services/cv";

interface CVFeedItem {
  routeId: string;
  observation: CVObservation;
  evidence: string[];
}

interface LiveStreetIntelligencePanelProps {
  feed: CVFeedItem[];
  live?: boolean;
}

export function LiveStreetIntelligencePanel({
  feed,
  live = true,
}: LiveStreetIntelligencePanelProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-pink-500/20 bg-pink-950/10">
      <div className="flex items-center justify-between border-b border-pink-500/15 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {live && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pink-500" />
            </span>
          )}
          <h3 className="text-xs font-semibold uppercase tracking-widest text-pink-300">
            Live Street Intelligence
          </h3>
        </div>
        <span className="font-mono text-[10px] text-pink-500/60">CV · MOCK</span>
      </div>

      <div className="space-y-3 p-4">
        {feed.map(({ routeId, observation, evidence }) => (
          <div
            key={routeId}
            className="rounded-lg border border-slate-800/80 bg-slate-900/40 p-3"
          >
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Route {routeId} · Live Feed
            </p>
            <div className="mb-2 flex gap-3 font-mono text-[10px] text-slate-600">
              <span>Crowd {observation.crowdDensity}</span>
              <span>Obstacles {observation.obstacleDensity}</span>
              <span>Visibility {observation.crossingVisibility}</span>
            </div>
            <ul className="space-y-1">
              {evidence.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-xs text-slate-400"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-pink-400/70" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
