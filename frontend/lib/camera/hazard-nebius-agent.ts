import "server-only";

import { callNebiusJson } from "@/lib/llm/nebius-json";
import { webSearchMany, type WebSearchResult } from "@/lib/search/web-search";
import type {
  AuthorityContact,
  HazardAnalysis,
  HazardReportEmail,
  ResolvedLocation,
} from "@/lib/camera/types";

const SEARCH_PLANNER_PROMPT = `You are a UK civic reporting research agent. Given a hazard type and GPS-resolved location in London, plan web searches to find the official organization email that handles this issue.

Return JSON only:
{
  "strategy": "1-2 sentences explaining your search approach",
  "queries": ["search query 1", "search query 2", "search query 3"]
}

Rules:
- Include borough/council name when known
- Include hazard type keywords (pavement, tactile paving, lift, crossing, etc.)
- Prefer queries that surface .gov.uk reporting emails or official contact pages
- Max 4 queries`;

const AUTHORITY_EXTRACTOR_PROMPT = `You are a UK civic reporting agent. You receive hazard analysis, GPS location, and web search results.

Extract the best official reporting contact and draft a professional email.

Rules:
- Prefer verified .gov.uk or tfl.gov.uk emails from search results
- If no email in results, use known public contacts: streets@tfl.gov.uk (TfL), borough highways teams
- Email must reference accessibility impact and include GPS coordinates
- body should be ready to send (professional, factual)

Return JSON only:
{
  "searchSummary": "how you chose this authority from search results",
  "confidence": "high|medium|low",
  "authority": {
    "name": "team name",
    "organization": "organization",
    "email": "contact email",
    "phone": "optional",
    "website": "optional",
    "reportUrl": "optional form URL",
    "reason": "why this authority owns the issue"
  },
  "email": {
    "to": "recipient email",
    "subject": "subject line",
    "body": "full email body plain text"
  }
}`;

export interface NebiusAgentResult {
  authority: AuthorityContact;
  email: HazardReportEmail;
  searchSummary: string;
  searchQueries: string[];
  searchStrategy: string;
  searchResults: WebSearchResult[];
  confidence: string;
}

export async function runNebiusHazardAgent(
  analysis: HazardAnalysis,
  resolvedLocation: ResolvedLocation | undefined,
  locationDescription?: string
): Promise<NebiusAgentResult> {
  const locationContext = [
    resolvedLocation?.displayName
      ? `Address: ${resolvedLocation.displayName}`
      : "",
    resolvedLocation?.borough ? `Borough: ${resolvedLocation.borough}` : "",
    resolvedLocation?.road ? `Street: ${resolvedLocation.road}` : "",
    resolvedLocation?.postcode ? `Postcode: ${resolvedLocation.postcode}` : "",
    resolvedLocation?.gps
      ? `GPS: ${resolvedLocation.gps.latitude.toFixed(6)}, ${resolvedLocation.gps.longitude.toFixed(6)}`
      : "",
    locationDescription ? `Area hint: ${locationDescription}` : "",
    analysis.locationHint ? `Visual clues: ${analysis.locationHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Agent step 1: plan web searches
  const { parsed: plan } = await callNebiusJson<{
    strategy: string;
    queries: string[];
  }>(
    SEARCH_PLANNER_PROMPT,
    [
      "Plan web searches to find the reporting authority email.",
      "",
      `Hazard type: ${analysis.hazardType}`,
      `Severity: ${analysis.severity}`,
      `Description: ${analysis.description}`,
      "",
      "Location:",
      locationContext || "London, UK",
    ].join("\n")
  );

  let queries = (plan.queries ?? []).filter(Boolean);
  if (!queries.length) {
    queries = [
      `${analysis.hazardType} report email ${resolvedLocation?.borough ?? "London"} council`,
      `TfL accessibility report email ${analysis.hazardType}`,
    ];
  }

  // Agent step 2: execute online searches
  const searchResults = await webSearchMany(queries, 4);

  // Agent step 3: extract authority + draft email from search results
  const { parsed: extracted } = await callNebiusJson<{
    searchSummary: string;
    confidence: string;
    authority: AuthorityContact;
    email: HazardReportEmail;
  }>(
    AUTHORITY_EXTRACTOR_PROMPT,
    [
      "Find the authority email and draft the report from these search results.",
      "",
      "Hazard analysis:",
      JSON.stringify(analysis, null, 2),
      "",
      "Location:",
      locationContext || "London, UK",
      "",
      "Search strategy:",
      plan.strategy,
      "",
      "Web search results:",
      JSON.stringify(searchResults, null, 2),
    ].join("\n"),
    { maxTokens: 8192 }
  );

  if (!extracted.email?.to?.trim()) {
    throw new Error("Agent could not find a reporting email — try again or edit manually.");
  }

  return {
    authority: extracted.authority,
    email: extracted.email,
    searchSummary: extracted.searchSummary,
    searchQueries: queries,
    searchStrategy: plan.strategy,
    searchResults,
    confidence: extracted.confidence ?? "medium",
  };
}
