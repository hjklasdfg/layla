import "server-only";

import type {
  AuthorityContact,
  HazardAnalysis,
  HazardReportEmail,
  HazardReportRequest,
  HazardReportResult,
  HazardReportStep,
  HazardSkillCallback,
  HazardSkillId,
  HazardSkillOutputs,
  HazardStepCallback,
} from "./types";
import { ensureLaylaNemoclawServer } from "./layla-nemoclaw-launcher";

interface NemoclawAgentResponse {
  status: string;
  message?: string;
  skills?: HazardSkillOutputs;
  steps?: HazardReportStep[];
  meta?: { source?: string; demo?: string };
}

function mapSeverity(severity: string | undefined): HazardAnalysis["severity"] {
  const s = (severity ?? "low").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function buildResult(body: NemoclawAgentResponse): HazardReportResult {
  const skills = body.skills ?? {};
  const hazard = skills.analyse_image ?? {};
  const location = skills.resolve_location ?? {};
  const authorityRaw = skills.search_authority ?? {};
  const content = skills.prepare_content ?? {};
  const emailRaw = skills.prepare_email ?? { to: "", subject: "", body: "" };

  const analysis: HazardAnalysis = {
    hazardType: hazard.hazard_type ?? content.hazard_type ?? "unknown",
    severity: mapSeverity(hazard.severity ?? content.severity),
    description: hazard.description ?? content.description ?? "",
    accessibilityImpact: hazard.accessibility_impact ?? content.accessibility_impact ?? "",
    suggestedAction: content.suggested_action ?? "Report to local highways team.",
    locationHint: location.road ?? location.display_name,
  };

  const authority: AuthorityContact = {
    name: authorityRaw.department ?? emailRaw.recipient_name ?? "Highways",
    organization: authorityRaw.authority_name ?? emailRaw.organization ?? "Local council",
    email: authorityRaw.email ?? emailRaw.to,
    reason: authorityRaw.source
      ? `Matched via ${authorityRaw.source}${authorityRaw.query ? `: ${authorityRaw.query}` : ""}`
      : "Local reporting authority",
  };

  const email: HazardReportEmail = {
    to: emailRaw.to ?? "",
    subject: emailRaw.subject ?? "",
    body: emailRaw.body ?? "",
  };

  const searchResults =
    authorityRaw.search_results?.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    })) ?? [];

  const resolvedLocation =
    location.lat != null && location.lng != null
      ? {
          displayName: location.display_name ?? "",
          borough: location.borough,
          road: location.road,
          postcode: location.postcode,
          gps: { latitude: location.lat, longitude: location.lng },
        }
      : undefined;

  const searchSummary = authorityRaw.authority_name
    ? `${authorityRaw.authority_name} via ${authorityRaw.source ?? "search"}`
    : "NemoClaw hazard agent";

  return {
    analysis,
    authority,
    email,
    resolvedLocation,
    searchSummary,
    agentReasoning: searchSummary,
    searchQueries: authorityRaw.query ? [authorityRaw.query] : [],
    searchResults,
    steps: body.steps ?? [],
    skills,
    provider: "nemoclaw",
  };
}

async function consumeSseStream(
  res: Response,
  onStep?: HazardStepCallback,
  onSkill?: HazardSkillCallback
): Promise<NemoclawAgentResponse> {
  if (!res.body) throw new Error("No response stream from NemoClaw agent");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: NemoclawAgentResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data: ")) continue;

      const event = JSON.parse(line.slice(6)) as {
        type: string;
        step?: HazardReportStep;
        skill?: HazardSkillId;
        output?: HazardSkillOutputs[HazardSkillId];
        result?: NemoclawAgentResponse;
        error?: string;
      };

      if (event.type === "step" && event.step) onStep?.(event.step);
      if (event.type === "skill" && event.skill && event.output) {
        onSkill?.(event.skill, event.output);
      }
      if (event.type === "complete" && event.result) complete = event.result;
      if (event.type === "error") throw new Error(event.error ?? "NemoClaw agent failed");
    }
  }

  if (!complete) throw new Error("NemoClaw agent stream ended without result");
  return complete;
}

export async function runNemoclawHazardReport(
  request: HazardReportRequest,
  onStep?: HazardStepCallback,
  onSkill?: HazardSkillCallback
): Promise<HazardReportResult> {
  if (!request.gps) {
    throw new Error("GPS required for NemoClaw hazard agent");
  }

  const server = await ensureLaylaNemoclawServer();
  const base = server.url.replace(/\/$/, "");

  const payload = {
    imageBase64: request.imageBase64,
    mimeType: request.mimeType,
    lat: request.gps.latitude,
    lng: request.gps.longitude,
    userProfile: "general",
  };

  const streamRes = await fetch(`${base}/hazard/report/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  let body: NemoclawAgentResponse & { error?: string };

  if (streamRes.ok && streamRes.headers.get("content-type")?.includes("text/event-stream")) {
    body = await consumeSseStream(streamRes, onStep, onSkill);
  } else {
    const res = await fetch(`${base}/hazard/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    try {
      body = (await res.json()) as NemoclawAgentResponse & { error?: string };
    } catch {
      throw new Error(`NemoClaw hazard agent returned invalid JSON (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(body.error ?? `NemoClaw hazard agent failed (${res.status})`);
    }
    for (const step of body.steps ?? []) onStep?.(step);
    const skillOrder: HazardSkillId[] = [
      "analyse_image",
      "resolve_location",
      "search_authority",
      "prepare_content",
      "prepare_email",
    ];
    for (const id of skillOrder) {
      const output = body.skills?.[id];
      if (output) onSkill?.(id, output);
    }
  }

  if (body.status === "no_hazard_detected") {
    throw new Error(body.message ?? "No clear road hazard was detected.");
  }

  if (body.status !== "report_preview_ready" || !body.skills?.prepare_email) {
    throw new Error("NemoClaw hazard agent returned an unexpected response.");
  }

  return buildResult(body);
}
