import "server-only";

import { runNebiusHazardAgent } from "@/lib/camera/hazard-nebius-agent";
import { callNebiusVisionJson } from "@/lib/llm/nebius-json";
import { serverEnv } from "@/lib/config/env";
import { reverseGeocode } from "@/services/osm/reverse-geocode";
import type {
  AuthorityContact,
  HazardAnalysis,
  HazardReportEmail,
  HazardReportRequest,
  HazardReportResult,
  HazardReportStep,
  HazardStepCallback,
  ResolvedLocation,
} from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";

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

const INITIAL_STEPS: HazardReportStep[] = [
  { id: "analyze_photo", label: "Identifying hazard type (Nebius AI vision)", status: "pending" },
  { id: "locate_gps", label: "Resolving location from GPS", status: "pending" },
  { id: "search_web", label: "Searching online for reporting authority", status: "pending" },
  { id: "find_authority", label: "Finding organization email (Nebius AI)", status: "pending" },
  { id: "draft_email", label: "Drafting report email (Nebius AI)", status: "pending" },
  { id: "ready", label: "Ready — click Send", status: "pending" },
];

export async function runHazardReportPipeline(
  request: HazardReportRequest,
  onStep?: HazardStepCallback
): Promise<HazardReportResult> {
  if (!serverEnv.nebiusai.enabled) {
    throw new Error("NEBUISAI_API_KEY not configured. Add it to .env.local.");
  }

  const steps: HazardReportStep[] = INITIAL_STEPS.map((s) => ({ ...s }));

  const updateStep = (id: HazardReportStep["id"], patch: Partial<HazardReportStep>) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx === -1) return;
    steps[idx] = { ...steps[idx], ...patch };
    emit(onStep, steps[idx]);
  };

  // Step 1: Vision — hazard type
  updateStep("analyze_photo", {
    status: "running",
    thought: "Nebius AI vision is classifying the hazard type and severity…",
  });

  let analysis: HazardAnalysis;
  try {
    analysis = await analyzeImage(request);
    updateStep("analyze_photo", {
      status: "done",
      thought: `Hazard type: ${analysis.hazardType} (${analysis.severity}).`,
      detail: analysis.description,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Photo analysis failed";
    updateStep("analyze_photo", { status: "error", thought: message });
    throw err;
  }

  // Step 2: GPS
  updateStep("locate_gps", {
    status: "running",
    thought: request.gps
      ? `Reverse geocoding ${request.gps.latitude.toFixed(5)}, ${request.gps.longitude.toFixed(5)}…`
      : "No GPS — agent will use visual clues only.",
  });

  let resolvedLocation: ResolvedLocation | undefined;
  try {
    if (request.gps) {
      const located = await resolveLocationFromGps(request.gps);
      resolvedLocation = located;
      updateStep("locate_gps", {
        status: "done",
        thought: located.borough
          ? `Located in ${located.borough}${located.road ? `, ${located.road}` : ""}.`
          : `Located near ${located.displayName}.`,
        detail: located.displayName,
      });
    } else {
      updateStep("locate_gps", {
        status: "done",
        thought: "No GPS — enable location for better authority matching.",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Geocoding failed";
    updateStep("locate_gps", {
      status: "done",
      thought: `GPS lookup failed (${message}). Continuing with coordinates.`,
    });
    if (request.gps) {
      resolvedLocation = {
        displayName: `${request.gps.latitude.toFixed(5)}, ${request.gps.longitude.toFixed(5)}`,
        gps: {
          latitude: request.gps.latitude,
          longitude: request.gps.longitude,
        },
      };
    }
  }

  // Steps 3–5: Nebius agentic loop (plan searches → web search → extract email + draft)
  updateStep("search_web", {
    status: "running",
    thought: "Nebius AI is planning web searches for the right reporting authority…",
  });
  updateStep("find_authority", { status: "pending" });
  updateStep("draft_email", { status: "pending" });

  let authority: AuthorityContact;
  let email: HazardReportEmail;
  let searchSummary: string;
  let searchQueries: string[] = [];
  let searchResults: HazardReportResult["searchResults"];

  try {
    const agent = await runNebiusHazardAgent(
      analysis,
      resolvedLocation,
      request.locationDescription
    );

    authority = agent.authority;
    email = agent.email;
    searchSummary = agent.searchSummary;
    searchQueries = agent.searchQueries;
    searchResults = agent.searchResults;

    updateStep("search_web", {
      status: "done",
      thought: agent.searchStrategy,
      detail: `${agent.searchResults.length} results from ${agent.searchQueries.length} queries`,
    });
    updateStep("find_authority", {
      status: "done",
      thought: searchSummary,
      detail: `${authority.organization} · ${email.to} (${agent.confidence} confidence)`,
    });
    updateStep("draft_email", {
      status: "done",
      thought: `Email drafted to ${email.to}.`,
      detail: email.subject,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nebius AI agent failed";
    updateStep("search_web", { status: "error", thought: message });
    updateStep("find_authority", { status: "error", thought: message });
    updateStep("draft_email", { status: "error", thought: message });
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
  };
}

/** @deprecated Use runHazardReportPipeline */
export async function analyzeHazardAndReport(
  request: HazardReportRequest
): Promise<HazardReportResult> {
  return runHazardReportPipeline(request);
}

export { sendEmailViaResend, sendEmailViaBackend };
