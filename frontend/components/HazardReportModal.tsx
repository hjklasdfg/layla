"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  HazardReportResult,
  HazardReportStep,
  HazardSkillId,
  HazardSkillOutputs,
  HazardStreamEvent,
} from "@/lib/camera/types";

const STEP_ORDER: HazardReportStep["id"][] = [
  "analyse_image",
  "resolve_location",
  "search_authority",
  "prepare_content",
  "prepare_email",
  "ready",
];

const SKILL_LABELS: Record<HazardSkillId, string> = {
  analyse_image: "1 · Analyse image (VLM)",
  resolve_location: "2 · Resolve location (geoweb)",
  search_authority: "3 · Search authority",
  prepare_content: "4 · Prepare content",
  prepare_email: "5 · Prepare email",
};

const IMAGE_INTRO_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function SkillOutputCard({
  skillId,
  output,
}: {
  skillId: HazardSkillId;
  output: NonNullable<HazardSkillOutputs[HazardSkillId]>;
}) {
  const rows: Array<{ k: string; v: string }> = [];

  if (skillId === "analyse_image" && "hazard_type" in output) {
    const o = output;
    rows.push(
      { k: "Type", v: o.hazard_type ?? "—" },
      { k: "Severity", v: o.severity ?? "—" },
      { k: "Confidence", v: o.confidence != null ? String(o.confidence) : "—" },
      { k: "Description", v: o.description ?? "—" },
      { k: "Accessibility", v: o.accessibility_impact ?? "—" }
    );
  } else if (skillId === "resolve_location" && "display_name" in output) {
    const o = output;
    rows.push(
      { k: "Address", v: o.display_name ?? "—" },
      { k: "Road", v: o.road ?? "—" },
      { k: "Borough", v: o.borough ?? "—" },
      { k: "Postcode", v: o.postcode ?? "—" },
      {
        k: "GPS",
        v: o.lat != null && o.lng != null ? `${o.lat}, ${o.lng}` : "—",
      }
    );
  } else if (skillId === "search_authority" && "authority_name" in output) {
    const o = output;
    rows.push(
      { k: "Organization", v: o.authority_name ?? "—" },
      { k: "Department", v: o.department ?? "—" },
      { k: "Email", v: o.email ?? "—" },
      { k: "Source", v: o.source ?? "—" },
      { k: "Query", v: o.query ?? "—" }
    );
  } else if (skillId === "prepare_content" && "headline" in output) {
    const o = output;
    rows.push(
      { k: "Headline", v: o.headline ?? "—" },
      { k: "Location", v: o.location_summary ?? "—" },
      { k: "Impact", v: o.accessibility_impact ?? "—" },
      { k: "Action", v: o.suggested_action ?? "—" }
    );
    if (o.facts?.length) {
      rows.push({ k: "Facts", v: o.facts.join(" · ") });
    }
  } else if (skillId === "prepare_email" && "subject" in output) {
    const o = output;
    rows.push(
      { k: "To", v: o.to ?? "—" },
      { k: "Subject", v: o.subject ?? "—" },
      { k: "Organization", v: o.organization ?? "—" }
    );
  }

  if (!rows.length) return null;

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/90">
        {SKILL_LABELS[skillId]}
      </p>
      <dl className="mt-2 space-y-1">
        {rows.map(({ k, v }) => (
          <div key={k} className="grid grid-cols-[5.5rem_1fr] gap-2 text-[11px]">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-300">{v}</dd>
          </div>
        ))}
      </dl>
      {skillId === "search_authority" &&
        "search_results" in output &&
        output.search_results &&
        output.search_results.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-[10px]">
            {output.search_results.slice(0, 3).map((r) => (
              <li key={r.url ?? r.title}>
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
        )}
    </div>
  );
}

interface HazardReportModalProps {
  open: boolean;
  onClose: () => void;
  onStart: () => Promise<{
    imageBase64: string;
    mimeType: string;
    gps?: { latitude: number; longitude: number; accuracy?: number; timestamp?: number } | null;
    locationDescription?: string;
  }>;
}

export function HazardReportModal({ open, onClose, onStart }: HazardReportModalProps) {
  const [steps, setSteps] = useState<HazardReportStep[]>([]);
  const [skillOutputs, setSkillOutputs] = useState<HazardSkillOutputs>({});
  const [result, setResult] = useState<HazardReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const [editableEmail, setEditableEmail] = useState({ to: "", subject: "", body: "" });
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [introComplete, setIntroComplete] = useState(false);

  const reset = useCallback(() => {
    setSteps([]);
    setSkillOutputs({});
    setResult(null);
    setError(null);
    setSendStatus(null);
    setEmailSent(false);
    setEditableEmail({ to: "", subject: "", body: "" });
    setImagePreviewUrl(null);
    setIntroComplete(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    let cancelled = false;

    const start = async () => {
      setSteps([]);
      setSkillOutputs({});
      setResult(null);
      setError(null);
      setSendStatus(null);
      setEmailSent(false);
      setEditableEmail({ to: "", subject: "", body: "" });
      setIntroComplete(false);
      setRunning(true);

      try {
        const payload = await onStart();
        if (cancelled) return;

        setImagePreviewUrl(`data:${payload.mimeType};base64,${payload.imageBase64}`);

        await sleep(IMAGE_INTRO_MS);
        if (cancelled) return;
        setIntroComplete(true);

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
            } else if (event.type === "skill" && event.skill && event.output) {
              setSkillOutputs((prev) => ({
                ...prev,
                [event.skill!]: event.output,
              }));
            } else if (event.type === "complete" && event.result) {
              setResult(event.result);
              if (event.result.skills) setSkillOutputs(event.result.skills);
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
              id === "ready"
                ? "Ready — click Send"
                : SKILL_LABELS[id as HazardSkillId] ?? id,
            status: "pending",
          })
        );

  const displaySkills = (Object.keys(SKILL_LABELS) as HazardSkillId[]).filter(
    (id) => skillOutputs[id] != null
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
              5 skills: VLM → location → authority → content → email
              {result?.provider ? ` · ${result.provider}` : ""}
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

        <div
          className={`flex-1 overflow-y-auto px-5 py-4 ${
            !introComplete && imagePreviewUrl ? "flex flex-col justify-center" : ""
          }`}
        >
          {imagePreviewUrl && (
            <div
              className={
                introComplete
                  ? "mb-4 overflow-hidden rounded-lg border border-slate-700/60 bg-black/40"
                  : "overflow-hidden rounded-xl border border-violet-500/30 bg-black/50 shadow-lg shadow-violet-950/40"
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Hazard photo for analysis"
                className={
                  introComplete
                    ? "max-h-52 w-full object-cover"
                    : "max-h-[min(55vh,400px)] w-full object-contain"
                }
              />
            </div>
          )}

          {introComplete && (
            <>
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
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        {step.thought}
                      </p>
                    )}
                    {step.detail && (
                      <p className="mt-0.5 text-[10px] text-slate-500">{step.detail}</p>
                    )}
                  </div>
                ))}
              </div>

              {displaySkills.length > 0 && (
                <div className="mt-5 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Skill outputs
                  </p>
                  {displaySkills.map((id) => (
                    <SkillOutputCard
                      key={id}
                      skillId={id}
                      output={skillOutputs[id]!}
                    />
                  ))}
                </div>
              )}

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

              {result && (
                <div className="mt-5 space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
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
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-500">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={editableEmail.subject}
                      onChange={(e) =>
                        setEditableEmail((p) => ({ ...p, subject: e.target.value }))
                      }
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

                  {sendStatus && (
                    <p
                      className={`text-[11px] ${emailSent ? "text-emerald-400" : "text-amber-300"}`}
                    >
                      {sendStatus}
                    </p>
                  )}
                </div>
              )}
            </>
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
