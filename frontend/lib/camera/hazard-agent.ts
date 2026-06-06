import "server-only";

import { serverEnv } from "@/lib/config/env";
import type {
  AuthorityContact,
  HazardAnalysis,
  HazardReportEmail,
  HazardReportRequest,
  HazardReportResult,
} from "./types";

const VISION_MODEL = process.env.GEMINI_VISION_MODEL?.trim() || "gemini-2.0-flash";

async function callGemini(
  body: Record<string, unknown>,
  useSearch = false
): Promise<string> {
  if (!serverEnv.gemini.enabled) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${serverEnv.gemini.apiKey}`;

  const payload = useSearch
    ? {
        ...body,
        tools: [{ google_search: {} }],
      }
    : body;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}

function parseJsonBlock<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Could not parse JSON from Gemini response");
  }
  return JSON.parse(match[0]) as T;
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

  const text = await callGemini({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: request.mimeType,
              data: request.imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  return parseJsonBlock<HazardAnalysis>(text);
}

async function findAuthorityAndDraftEmail(
  analysis: HazardAnalysis,
  request: HazardReportRequest
): Promise<{ authority: AuthorityContact; email: HazardReportEmail; searchSummary: string }> {
  const locationContext = [
    request.locationDescription ? `Area: ${request.locationDescription}` : "",
    request.gps
      ? `GPS: ${request.gps.latitude.toFixed(5)}, ${request.gps.longitude.toFixed(5)}`
      : "London, UK",
    analysis.locationHint ? `Visual clues: ${analysis.locationHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are an agentic civic reporting assistant for London accessibility hazards.

Hazard analysis:
${JSON.stringify(analysis, null, 2)}

Location context:
${locationContext}

Use web search to find the correct reporting authority (TfL, borough council, FixMyStreet, etc.)
with a real contact email or official report URL for this hazard type in London.

Return ONLY valid JSON:
{
  "searchSummary": "brief note on how you chose the authority",
  "authority": {
    "name": "contact or team name",
    "organization": "organization name",
    "email": "reporting email if publicly listed, else empty string",
    "phone": "optional",
    "website": "optional",
    "reportUrl": "official online report form if available",
    "reason": "why this authority owns the issue"
  },
  "email": {
    "to": "recipient email — use streets@tfl.gov.uk or borough contact if unsure",
    "subject": "concise subject",
    "body": "professional report email referencing accessibility impact, GPS if available, and requested action"
  }
}`;

  const text = await callGemini(
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    },
    true
  );

  const parsed = parseJsonBlock<{
    searchSummary: string;
    authority: AuthorityContact;
    email: HazardReportEmail;
  }>(text);

  return {
    authority: parsed.authority,
    email: parsed.email,
    searchSummary: parsed.searchSummary,
  };
}

async function sendEmailViaBackend(email: HazardReportEmail, analysis: HazardAnalysis): Promise<boolean> {
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

export async function analyzeHazardAndReport(
  request: HazardReportRequest
): Promise<HazardReportResult> {
  const analysis = await analyzeImage(request);
  const { authority, email, searchSummary } = await findAuthorityAndDraftEmail(
    analysis,
    request
  );

  let emailSent = false;
  let emailStatus = "Draft prepared — configure RESEND_API_KEY or BACKEND_API_URL to send automatically.";

  if (await sendEmailViaBackend(email, analysis)) {
    emailSent = true;
    emailStatus = "Report emailed via backend agent.";
  } else if (await sendEmailViaResend(email)) {
    emailSent = true;
    emailStatus = `Report sent to ${email.to}.`;
  } else if (email.to) {
    emailStatus = `Draft ready for ${email.to}. Add RESEND_API_KEY or backend email handler to send automatically.`;
  }

  return {
    analysis,
    authority,
    email,
    emailSent,
    emailStatus,
    searchSummary,
  };
}
