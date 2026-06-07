"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  HazardReportResult,
  HazardReportStep,
  HazardStreamEvent,
} from "@/lib/camera/types";

const STEP_ORDER: HazardReportStep["id"][] = [
  "analyze_photo",
  "locate_gps",
  "search_web",
  "find_authority",
  "draft_email",
  "ready",
];

function stepIcon(status: HazardReportStep["status"]) {
  if (status === "running") return "◉";
  if (status === "done") return "✓";
  if (status === "error") return "✕";
  return "○";
}

function stepColor(status: HazardReportStep["status"]) {
  if (status === "running") return "text-violet-300";
  if (status === "done") return "text-emerald-400";
  if (status === "error") return "text-red-400";
  return "text-slate-500";
}

interface HazardReportModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when user clicks Report hazard — returns captured image payload */
  onStart: () => Promise<{
    imageBase64: string;
    mimeType: string;
    gps?: { latitude: number; longitude: number; accuracy?: number; timestamp?: number } | null;
    locationDescription?: string;
  }>;
}

export function HazardReportModal({ open, onClose, onStart }: HazardReportModalProps) {
  const [steps, setSteps] = useState<HazardReportStep[]>([]);
  const [result, setResult] = useState<HazardReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const [editableEmail, setEditableEmail] = useState({ to: "", subject: "", body: "" });

  const reset = useCallback(() => {
    setSteps([]);
    setResult(null);
    setError(null);
    setSendStatus(null);
    setEmailSent(false);
    setEditableEmail({ to: "", subject: "", body: "" });
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    let cancelled = false;

    const start = async () => {
      reset();
      setRunning(true);

      try {
        const payload = await onStart();
        if (cancelled) return;

        const res = await fetch("/api/camera/report/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errBody = (await res.json()) as { error?: string };
          throw new Error(errBody.error ?? `Report failed (${res.status})`);
        }

        if (!res.body) throw new Error("No response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const chunk of lines) {
            const line = chunk.trim();
            if (!line.startsWith("data: ")) continue;

            const event = JSON.parse(line.slice(6)) as HazardStreamEvent;

            if (event.type === "step" && event.step) {
              setSteps((prev) => {
                const idx = prev.findIndex((s) => s.id === event.step!.id);
                if (idx === -1) return [...prev, event.step!];
                const next = [...prev];
                next[idx] = event.step!;
                return next;
              });
            } else if (event.type === "complete" && event.result) {
              setResult(event.result);
              setEditableEmail({
                to: event.result.email.to,
                subject: event.result.email.subject,
                body: event.result.email.body,
              });
              setSteps(event.result.steps);
            } else if (event.type === "error") {
              throw new Error(event.error ?? "Hazard report failed");
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Hazard report failed");
        }
      } finally {
        if (!cancelled) setRunning(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open
  }, [open]);

  const handleSend = useCallback(async () => {
    if (!result || !editableEmail.to.trim()) return;

    setSending(true);
    setSendStatus(null);

    try {
      const res = await fetch("/api/camera/report/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editableEmail,
          analysis: result.analysis,
        }),
      });

      const payload = (await res.json()) as {
        emailSent?: boolean;
        emailStatus?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(payload.error ?? "Send failed");

      setEmailSent(Boolean(payload.emailSent));
      setSendStatus(payload.emailStatus ?? "Sent.");
    } catch (err) {
      setSendStatus(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }, [result, editableEmail]);

  const handleMailto = useCallback(() => {
    const params = new URLSearchParams({
      subject: editableEmail.subject,
      body: editableEmail.body,
    });
    window.location.href = `mailto:${encodeURIComponent(editableEmail.to)}?${params.toString()}`;
  }, [editableEmail]);

  if (!open) return null;

  const orderedSteps =
    steps.length > 0
      ? STEP_ORDER.map((id) => steps.find((s) => s.id === id)).filter(
          (s): s is HazardReportStep => s !== undefined
        )
      : STEP_ORDER.map(
          (id): HazardReportStep => ({
            id,
            label:
              id === "analyze_photo"
                ? "Identifying hazard type (Nebius AI vision)"
                : id === "locate_gps"
                  ? "Resolving location from GPS"
                  : id === "search_web"
                    ? "Searching online for reporting authority"
                    : id === "find_authority"
                      ? "Finding organization email (Nebius AI)"
                      : id === "draft_email"
                        ? "Drafting report email (Nebius AI)"
                        : "Ready — click Send",
            status: "pending",
          })
        );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hazard-report-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-slate-950 shadow-2xl shadow-violet-950/50">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="hazard-report-title" className="text-sm font-semibold text-violet-100">
              Hazard report agent
            </h2>
            <p className="text-[11px] text-slate-500">
              Nebius AI vision → GPS → web search → email draft
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Thinking steps */}
          <div className="space-y-3">
            {orderedSteps.map((step, i) => (
              <div key={step.id} className="relative pl-6">
                {i < orderedSteps.length - 1 && (
                  <span
                    className={`absolute left-[7px] top-5 h-[calc(100%+4px)] w-px ${
                      step.status === "done" ? "bg-emerald-500/40" : "bg-slate-700"
                    }`}
                  />
                )}
                <span
                  className={`absolute left-0 top-0.5 text-sm font-bold ${stepColor(step.status)} ${
                    step.status === "running" ? "animate-pulse" : ""
                  }`}
                >
                  {stepIcon(step.status)}
                </span>
                <p className={`text-xs font-medium ${stepColor(step.status)}`}>{step.label}</p>
                {step.thought && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{step.thought}</p>
                )}
                {step.detail && (
                  <p className="mt-0.5 text-[10px] text-slate-500">{step.detail}</p>
                )}
              </div>
            ))}
          </div>

          {running && (
            <div className="mt-4 flex items-center gap-2 text-[11px] text-violet-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
              Agent working… this may take up to a minute
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Final email draft */}
          {result && (
            <div className="mt-5 space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-emerald-200">
                    {result.analysis.hazardType} · {result.analysis.severity}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{result.analysis.description}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wide text-slate-500">
                  To (authority email)
                </label>
                <input
                  type="email"
                  value={editableEmail.to}
                  onChange={(e) => setEditableEmail((p) => ({ ...p, to: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500/50"
                />
                {result.authority.organization && (
                  <p className="text-[10px] text-slate-500">
                    {result.authority.organization}
                    {result.authority.reason ? ` — ${result.authority.reason}` : ""}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wide text-slate-500">
                  Subject
                </label>
                <input
                  type="text"
                  value={editableEmail.subject}
                  onChange={(e) => setEditableEmail((p) => ({ ...p, subject: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wide text-slate-500">
                  Email body
                </label>
                <textarea
                  value={editableEmail.body}
                  onChange={(e) => setEditableEmail((p) => ({ ...p, body: e.target.value }))}
                  rows={8}
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-200 outline-none focus:border-violet-500/50"
                />
              </div>

              {result.searchResults && result.searchResults.length > 0 && (
                <details className="text-[10px] text-slate-500">
                  <summary className="cursor-pointer text-slate-400">
                    Web sources ({result.searchResults.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {result.searchResults.slice(0, 5).map((r) => (
                      <li key={r.url}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-500/80 underline"
                        >
                          {r.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {result.authority.reportUrl && (
                <a
                  href={result.authority.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] text-cyan-400 underline"
                >
                  Official online report form
                </a>
              )}

              {sendStatus && (
                <p
                  className={`text-[11px] ${emailSent ? "text-emerald-400" : "text-amber-300"}`}
                >
                  {sendStatus}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800"
          >
            {result ? "Close" : "Cancel"}
          </button>

          {result && (
            <>
              <button
                type="button"
                onClick={handleMailto}
                className="rounded-lg bg-slate-800 px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
              >
                Open in mail app
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || emailSent || !editableEmail.to.trim()}
                className="ml-auto rounded-lg bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
              >
                {sending ? "Sending…" : emailSent ? "Sent ✓" : "Send email"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
