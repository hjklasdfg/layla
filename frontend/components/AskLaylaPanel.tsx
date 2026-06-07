"use client";

const EXAMPLES = [
  "Is it safe around Liverpool Street?",
  "How noisy is Bank?",
  "Does Barbican have tactile paving?",
  "Is the tube running OK?",
];

/** Presentational — page.tsx owns the state so typed AND spoken questions share
 *  one answer box and one voice. */
export function AskLaylaPanel({
  question,
  onQuestionChange,
  onAsk,
  answer,
  loading,
  error,
  listening,
}: {
  question: string;
  onQuestionChange: (v: string) => void;
  onAsk: (q: string) => void;
  answer: string | null;
  loading: boolean;
  error: string | null;
  listening?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/30 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
          Ask Layla anything
        </p>
        {listening && (
          <span className="flex items-center gap-1.5 text-[11px] text-cyan-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" /> listening
          </span>
        )}
      </div>
      <p className="-mt-1 text-[11px] text-slate-500">
        Use the mic above, or type — safety, noise, accessibility, transit · Nemotron on the DGX Spark
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAsk(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="e.g. Is it safe around Liverpool Street?"
          className="flex-1 rounded-lg border border-slate-600/60 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!question.trim() || loading}
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
              onQuestionChange(ex);
              onAsk(ex);
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
