"use client";

import { useState } from "react";

const EXAMPLES = [
  "Is it safe around Liverpool Street?",
  "How noisy is Bank?",
  "Does Barbican have tactile paving?",
  "Is the tube running OK?",
];

export function AskLaylaPanel() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `ask failed (${res.status})`);
      setAnswer(d.answer || "(no answer)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ask failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/30 bg-slate-900/40 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
          Ask Layla anything
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Open-data Q&amp;A — safety, noise, accessibility, transit · Nemotron on the DGX Spark
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Is it safe around Liverpool Street?"
          className="flex-1 rounded-lg border border-slate-600/60 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!q.trim() || loading}
          className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setQ(ex);
              ask(ex);
            }}
            className="rounded-full border border-slate-600/50 px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-300"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-red-300">{error}</p>}
      {answer && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-3 py-2.5 text-sm leading-relaxed text-slate-200">
          {answer}
        </div>
      )}
    </div>
  );
}
