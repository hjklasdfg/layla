"use client";

import { useEffect, useRef, useState } from "react";
import {
  getScoreBarColor,
  getScoreColor,
  getScoreLabel,
} from "@/lib/ui/scores";

interface AnimatedScoreMetricProps {
  label: string;
  value: number;
  previousValue?: number;
  invert?: boolean;
}

export function AnimatedScoreMetric({
  label,
  value,
  previousValue,
  invert = false,
}: AnimatedScoreMetricProps) {
  const [flash, setFlash] = useState(false);
  const [delta, setDelta] = useState<number | null>(null);
  const prevRef = useRef(previousValue);

  useEffect(() => {
    if (
      previousValue !== undefined &&
      prevRef.current !== undefined &&
      previousValue !== value
    ) {
      const d = value - previousValue;
      setDelta(d);
      setFlash(true);
      const t = setTimeout(() => {
        setFlash(false);
        setDelta(null);
      }, 2200);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value, previousValue]);

  const improved = delta !== null ? (invert ? delta < 0 : delta > 0) : false;
  const worsened = delta !== null ? (invert ? delta > 0 : delta < 0) : false;

  return (
    <div
      className={`space-y-1.5 rounded-lg p-1.5 transition-colors duration-500 ${
        flash
          ? improved
            ? "bg-emerald-500/10"
            : worsened
              ? "bg-red-500/10"
              : "bg-amber-500/10"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-1.5 text-xs">
        <span className="min-w-0 truncate text-slate-400">{label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {delta !== null && (
            <span
              className={`font-mono text-[10px] font-bold ${
                improved ? "text-emerald-400" : worsened ? "text-red-400" : "text-amber-400"
              }`}
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          )}
          <span
            className={`font-mono font-semibold transition-all duration-700 ${getScoreColor(value, invert)}`}
          >
            {value}
            <span className="font-normal text-slate-500">/100</span>
          </span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${getScoreBarColor(value, invert)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span
        className={`text-[10px] uppercase tracking-wider ${getScoreColor(value, invert)}`}
      >
        {getScoreLabel(value, invert)}
      </span>
    </div>
  );
}
