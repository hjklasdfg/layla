"use client";

import type { TimelineEntry } from "@/lib/events/types";

interface ChangeTimelineProps {
  entries: TimelineEntry[];
}

const SEVERITY_DOT: Record<TimelineEntry["severity"], string> = {
  info: "bg-slate-500",
  warning: "bg-amber-400",
  critical: "bg-red-400",
};

export function ChangeTimeline({ entries }: ChangeTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        Condition Timeline
      </h3>
      <ol className="relative space-y-0 border-l border-slate-800 pl-4">
        {entries.map((entry, i) => (
          <li
            key={entry.id}
            className={`relative pb-3 ${i === 0 ? "animate-[fadeIn_0.4s_ease-out]" : ""}`}
          >
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900 ${SEVERITY_DOT[entry.severity]}`}
            />
            <div className="flex items-baseline gap-2">
              <time className="shrink-0 font-mono text-[11px] text-slate-500">
                {entry.time}
              </time>
              <p className="text-xs leading-snug text-slate-400">{entry.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
