import "server-only";

import { runNemoclawHazardReport } from "@/lib/camera/hazard-nemoclaw-agent";
import { runNebiusHazardAgent } from "@/lib/camera/hazard-nebius-agent";
import { callNebiusVisionJson } from "@/lib/llm/nebius-json";
import { serverEnv } from "@/lib/config/env";
import {
  fallbackGpsForLandmark,
  formatFallbackLocationSummary,
} from "@/lib/mobility/fallback-gps";
import { reverseGeocode } from "@/services/osm/reverse-geocode";
import type {
  AuthorityContact,
  HazardAnalysis,
  HazardReportEmail,
  HazardReportRequest,
  HazardReportResult,
  HazardReportStep,
  HazardSkillCallback,
  HazardSkillOutputs,
  HazardStepCallback,
  ResolvedLocation,
} from "./types";
import type { GpsLocation } from "@/lib/mobility/sensors";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";

function resolveEffectiveReportGps(request: HazardReportRequest): {
  gps: GpsLocation;
  simulated: boolean;
  landmarkId?: string;
} | null {
  if (request.gps) {
    return { gps: request.gps, simulated: false };
  }

  const disabled = ["false", "0", "off", "none"].includes(
    serverEnv.cameraHazard.hazardReportFallbackLocation.toLowerCase()
  );
  if (disabled) return null;

  const landmarkId = serverEnv.cameraHazard.hazardReportFallbackLocation;

  if (!landmarkId) return null;

  const gps = fallbackGpsForLandmark(landmarkId);
  if (!gps) return null;

  return { gps, simulated: true, landmarkId };
}

function emit(onStep: HazardStepCallback | undefined, step: HazardReportStep) {
  onStep?.(step);
}

async function analyzeImage(request: HazardReportRequest): Promise<HazardAnalysis> {
  const locationContext = [
    request.locationDescription ? `Area: ${request.locationDescription}` : "",
    request.gps
      ? `GPS: ${request.gps.latitude.toFixed(5)}, ${request.gps.longitude.toFixed(5)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are an accessibility-focused road hazard analyst for London streets.
Analyze this image for hazards affecting pedestrians, wheelchair users, and blind travellers.

${locationContext}

Return ONLY valid JSON:
{
  "hazardType": "e.g. broken tactile paving, lift outage, blocked crossing",
  "severity": "low|medium|high|critical",
  "description": "what you see",
  "accessibilityImpact": "who is affected and how",
  "suggestedAction": "immediate mitigation",
  "locationHint": "visible street clues if any"
}`;

  const { parsed } = await callNebiusVisionJson<HazardAnalysis>(
    prompt,
    request.imageBase64,
    request.mimeType
  );

  return parsed;
}

async function resolveLocationFromGps(gps: {
  latitude: number;
  longitude: number;
}): Promise<ResolvedLocation> {
  const place = await reverseGeocode(gps.latitude, gps.longitude, {
    nominatimUrl: NOMINATIM_URL,
    userAgent: serverEnv.osm.userAgent,
  });

  return {
    displayName: place.displayName,
    borough: place.borough,
    road: place.road,
    postcode: place.postcode,
    gps: {
      latitude: gps.latitude,
      longitude: gps.longitude,
    },
  };
}

export async function sendHazardReportEmail(
  email: HazardReportEmail,
  analysis: HazardAnalysis
): Promise<{ sent: boolean; status: string }> {
  if (await sendEmailViaBackend(email, analysis)) {
    return { sent: true, status: `Report sent to ${email.to} via backend.` };
  }

  if (await sendEmailViaResend(email)) {
    return { sent: true, status: `Report sent to ${email.to}.` };
  }

  if (!email.to) {
    return { sent: false, status: "No recipient email found." };
  }

  return {
    sent: false,
    status: `Draft ready for ${email.to}. Add RESEND_API_KEY or use Open in mail app.`,
  };
}

async function sendEmailViaBackend(
  email: HazardReportEmail,
  analysis: HazardAnalysis
): Promise<boolean> {
  if (!serverEnv.backend.enabled) return false;

  const url = `${serverEnv.backend.apiUrl.replace(/\/$/, "")}/camera/report-email`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(serverEnv.backend.apiKey
        ? { Authorization: `Bearer ${serverEnv.backend.apiKey}` }
        : {}),
    },
    body: JSON.stringify({ email, analysis }),
  });

  return res.ok;
}

async function sendEmailViaResend(email: HazardReportEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.HAZARD_REPORT_FROM_EMAIL?.trim();
  if (!apiKey || !from || !email.to) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.body,
    }),
  });

  return res.ok;
}

const NEBIUS_STEPS: HazardReportStep[] = [
  { id: "analyse_image", label: "Analyse image (Nebius vision)", status: "pending" },
  { id: "resolve_location", label: "Resolve location (GPS)", status: "pending" },
  { id: "search_authority", label: "Search authority (Nebius web)", status: "pending" },
  { id: "prepare_content", label: "Prepare report content", status: "pending" },
  { id: "prepare_email", label: "Prepare email draft", status: "pending" },
  { id: "ready", label: "Ready — click Send", status: "pending" },
];

async function runNebiusHazardReportPipeline(
  effectiveRequest: HazardReportRequest,
  effectiveLocation: ReturnType<typeof resolveEffectiveReportGps>,
  onStep?: HazardStepCallback,
  onSkill?: HazardSkillCallback
): Promise<HazardReportResult> {
  const skills: HazardSkillOutputs = {};
  const emitSkill = <K extends keyof HazardSkillOutputs>(
    id: K,
    output: HazardSkillOutputs[K]
  ) => {
    skills[id] = output;
    if (output) onSkill?.(id, output);
  };
  const steps: HazardReportStep[] = NEBIUS_STEPS.map((s) => ({ ...s }));

  const updateStep = (id: HazardReportStep["id"], patch: Partial<HazardReportStep>) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx === -1) return;
    steps[idx] = { ...steps[idx], ...patch };
    emit(onStep, steps[idx]);
  };

  updateStep("analyse_image", {
    status: "running",
    thought: "Nebius AI vision is classifying the hazard type and severity…",
  });

  let analysis: HazardAnalysis;
  try {
    analysis = await analyzeImage(effectiveRequest);
    emitSkill("analyse_image", {
      hazard_detected: true,
      hazard_type: analysis.hazardType,
      severity: analysis.severity,
      description: analysis.description,
      accessibility_impact: analysis.accessibilityImpact,
      model: "nebius-vision",
    });
    updateStep("analyse_image", {
      status: "done",
      thought: `Hazard type: ${analysis.hazardType} (${analysis.severity}).`,
      detail: analysis.description,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Photo analysis failed";
    updateStep("analyse_image", { status: "error", thought: message });
    throw err;
  }

  const fallbackSummary =
    effectiveLocation?.simulated && effectiveLocation.landmarkId && effectiveRequest.gps
      ? formatFallbackLocationSummary(
          effectiveRequest.gps,
          effectiveLocation.landmarkId
        )
      : null;

  updateStep("resolve_location", {
    status: "running",
    thought: fallbackSummary
      ? `${fallbackSummary} — resolving address…`
      : effectiveRequest.gps
        ? `Reverse geocoding ${effectiveRequest.gps.latitude.toFixed(5)}, ${effectiveRequest.gps.longitude.toFixed(5)}…`
        : "No GPS — agent will use visual clues only.",
  });

  let resolvedLocation: ResolvedLocation | undefined;
  try {
    if (effectiveRequest.gps) {
      const located = await resolveLocationFromGps(effectiveRequest.gps);
      resolvedLocation = located;
      emitSkill("resolve_location", {
        lat: located.gps?.latitude,
        lng: located.gps?.longitude,
        display_name: located.displayName,
        road: located.road,
        borough: located.borough,
        postcode: located.postcode,
        source: "nominatim",
      });
      updateStep("resolve_location", {
        status: "done",
        thought: fallbackSummary
          ? `${fallbackSummary}${located.borough ? ` (${located.borough})` : ""}.`
          : located.borough
            ? `Located in ${located.borough}${located.road ? `, ${located.road}` : ""}.`
            : `Located near ${located.displayName}.`,
        detail: located.displayName,
      });
    } else {
      updateStep("resolve_location", {
        status: "done",
        thought: "No GPS — enable location for better authority matching.",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Geocoding failed";
    updateStep("resolve_location", {
      status: "done",
      thought: fallbackSummary
        ? `${fallbackSummary}.`
        : `GPS lookup failed (${message}). Continuing with coordinates.`,
    });
    if (effectiveRequest.gps) {
      resolvedLocation = {
        displayName: fallbackSummary
          ? "St Pancras, London"
          : `${effectiveRequest.gps.latitude.toFixed(5)}, ${effectiveRequest.gps.longitude.toFixed(5)}`,
        gps: {
          latitude: effectiveRequest.gps.latitude,
          longitude: effectiveRequest.gps.longitude,
        },
      };
    }
  }

  updateStep("search_authority", {
    status: "running",
    thought: "Nebius AI is planning web searches for the right reporting authority…",
  });
  updateStep("prepare_content", { status: "pending" });
  updateStep("prepare_email", { status: "pending" });

  let authority: AuthorityContact;
  let email: HazardReportEmail;
  let searchSummary: string;
  let searchQueries: string[] = [];
  let searchResults: HazardReportResult["searchResults"];

  try {
    const agent = await runNebiusHazardAgent(
      analysis,
      resolvedLocation,
      effectiveRequest.locationDescription
    );

    authority = agent.authority;
    email = agent.email;
    searchSummary = agent.searchSummary;
    searchQueries = agent.searchQueries;
    searchResults = agent.searchResults;

    emitSkill("search_authority", {
      authority_name: authority.organization,
      department: authority.name,
      email: authority.email,
      source: "nebius_web_search",
      query: agent.searchQueries[0],
      search_results: agent.searchResults.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.snippet,
      })),
    });
    updateStep("search_authority", {
      status: "done",
      thought: agent.searchStrategy,
      detail: `${agent.searchResults.length} results · ${authority.organization} (${agent.confidence})`,
    });

    const content = {
      headline: `${analysis.hazardType} — ${analysis.severity}`,
      hazard_type: analysis.hazardType,
      severity: analysis.severity,
      description: analysis.description,
      accessibility_impact: analysis.accessibilityImpact,
      location_summary: resolvedLocation?.displayName,
      facts: [
        `Hazard: ${analysis.hazardType}`,
        `Severity: ${analysis.severity}`,
        resolvedLocation?.borough ? `Borough: ${resolvedLocation.borough}` : "",
      ].filter(Boolean),
      suggested_action: analysis.suggestedAction,
    };
    emitSkill("prepare_content", content);
    updateStep("prepare_content", {
      status: "done",
      thought: content.headline,
      detail: resolvedLocation?.road ?? resolvedLocation?.displayName,
    });

    emitSkill("prepare_email", {
      ...email,
      recipient_name: authority.name,
      organization: authority.organization,
    });
    updateStep("prepare_email", {
      status: "done",
      thought: `Email drafted to ${email.to}.`,
      detail: email.subject,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nebius AI agent failed";
    updateStep("search_authority", { status: "error", thought: message });
    updateStep("prepare_content", { status: "error", thought: message });
    updateStep("prepare_email", { status: "error", thought: message });
    throw err;
  }

  updateStep("ready", {
    status: "done",
    thought: "Email ready. Review and click Send.",
  });

  return {
    analysis,
    authority,
    email,
    resolvedLocation,
    searchSummary,
    agentReasoning: searchSummary,
    searchQueries,
    searchResults,
    steps,
    skills,
    provider: "nebius",
  };
}

export function hazardReportAvailable(): boolean {
  return serverEnv.laylaNemoclaw.enabled || serverEnv.nebiusai.enabled;
}

export async function runHazardReportPipeline(
  request: HazardReportRequest,
  onStep?: HazardStepCallback,
  onSkill?: HazardSkillCallback
): Promise<HazardReportResult> {
  if (!hazardReportAvailable()) {
    throw new Error(
      "No hazard report backend configured. Start backend/layla-nemoclaw or add NEBUISAI_API_KEY to .env.local."
    );
  }

  const effectiveLocation = resolveEffectiveReportGps(request);
  const effectiveRequest: HazardReportRequest = effectiveLocation
    ? { ...request, gps: effectiveLocation.gps }
    : request;

  if (serverEnv.laylaNemoclaw.enabled && effectiveRequest.gps) {
    try {
      return await runNemoclawHazardReport(effectiveRequest, onStep, onSkill);
    } catch (nemoclawErr) {
      if (!serverEnv.nebiusai.enabled) {
        throw nemoclawErr;
      }
      const reason =
        nemoclawErr instanceof Error ? nemoclawErr.message : "NemoClaw agent failed";
      onStep?.({
        id: "analyse_image",
        label: "Analyse image (NemoClaw)",
        status: "running",
        thought: `NemoClaw unavailable (${reason}). Falling back to Nebius…`,
      });
    }
  }

  if (!serverEnv.nebiusai.enabled) {
    throw new Error(
      "NEBUISAI_API_KEY not configured. Add it to .env.local for hazard report fallback."
    );
  }

  return runNebiusHazardReportPipeline(
    effectiveRequest,
    effectiveLocation,
    onStep,
    onSkill
  );
}

/** @deprecated Use runHazardReportPipeline */
export async function analyzeHazardAndReport(
  request: HazardReportRequest
): Promise<HazardReportResult> {
  return runHazardReportPipeline(request);
}

export { sendEmailViaResend, sendEmailViaBackend };
