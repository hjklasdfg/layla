"use client";

import { CITY_EVENTS, type CityEventType } from "@/lib/events/types";

interface EventSimulatorProps {
  onSimulate: (eventType: CityEventType) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function EventSimulator({
  onSimulate,
  disabled,
  loading,
}: EventSimulatorProps) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-amber-400">
        Simulate City Event
      </h3>
      <p className="mb-3 text-[11px] text-slate-500">
        Trigger live condition changes — scores and recommendations update
        automatically.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {CITY_EVENTS.map((event) => (
          <button
            key={event.type}
            type="button"
            onClick={() => onSimulate(event.type)}
            disabled={disabled || loading}
            className="rounded-lg border border-amber-500/25 bg-amber-950/30 px-3 py-2 text-left text-xs font-medium text-amber-200/90 transition hover:border-amber-400/50 hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {event.label}
          </button>
        ))}
      </div>
    </div>
  );
}
