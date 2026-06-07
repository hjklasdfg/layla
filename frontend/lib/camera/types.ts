import type { GpsLocation } from "@/lib/mobility/sensors";

export interface HazardAnalysis {
  hazardType: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  accessibilityImpact: string;
  suggestedAction: string;
  locationHint?: string;
}

export interface AuthorityContact {
  name: string;
  organization: string;
  email?: string;
  phone?: string;
  website?: string;
  reportUrl?: string;
  reason: string;
}

export interface HazardReportEmail {
  to: string;
  subject: string;
  body: string;
}

export interface ResolvedLocation {
  displayName: string;
  borough?: string;
  road?: string;
  postcode?: string;
  gps?: { latitude: number; longitude: number };
}

/** One skill in the five-skill hazard pipeline */
export type HazardSkillId =
  | "analyse_image"
  | "resolve_location"
  | "search_authority"
  | "prepare_content"
  | "prepare_email";

export type HazardStepId = HazardSkillId | "ready";

export type HazardStepStatus = "pending" | "running" | "done" | "error";

export interface HazardReportStep {
  id: HazardStepId;
  label: string;
  status: HazardStepStatus;
  thought?: string;
  detail?: string;
}

export interface HazardAnalyseImageOutput {
  hazard_detected?: boolean;
  hazard_type?: string;
  severity?: string;
  description?: string;
  accessibility_impact?: string;
  confidence?: number;
  model?: string;
}

export interface HazardResolveLocationOutput {
  lat?: number;
  lng?: number;
  display_name?: string;
  road?: string;
  borough?: string;
  postcode?: string;
  country?: string;
  source?: string;
}

export interface HazardSearchAuthorityOutput {
  authority_name?: string;
  department?: string;
  email?: string;
  source?: string;
  query?: string;
  search_results?: Array<{ title?: string; url?: string; description?: string }>;
}

export interface HazardPrepareContentOutput {
  headline?: string;
  hazard_type?: string;
  severity?: string;
  description?: string;
  accessibility_impact?: string;
  confidence?: number;
  location_summary?: string;
  facts?: string[];
  gps?: { lat?: number; lng?: number };
  user_profile?: string;
  suggested_action?: string;
}

export interface HazardPrepareEmailOutput extends HazardReportEmail {
  recipient_name?: string;
  organization?: string;
}

export interface HazardSkillOutputs {
  analyse_image?: HazardAnalyseImageOutput;
  resolve_location?: HazardResolveLocationOutput;
  search_authority?: HazardSearchAuthorityOutput;
  prepare_content?: HazardPrepareContentOutput;
  prepare_email?: HazardPrepareEmailOutput;
}

export interface HazardReportResult {
  analysis: HazardAnalysis;
  authority: AuthorityContact;
  email: HazardReportEmail;
  resolvedLocation?: ResolvedLocation;
  searchSummary?: string;
  agentReasoning?: string;
  searchQueries?: string[];
  searchResults?: Array<{ title: string; url: string; snippet: string }>;
  steps: HazardReportStep[];
  /** Raw output from each of the five skills (NemoClaw path) */
  skills?: HazardSkillOutputs;
  provider?: "nemoclaw" | "nebius";
  emailSent?: boolean;
  emailStatus?: string;
}

export interface HazardReportRequest {
  imageBase64: string;
  mimeType: string;
  gps?: GpsLocation | null;
  locationDescription?: string;
}

export interface HazardReportSendRequest {
  email: HazardReportEmail;
  analysis: HazardAnalysis;
}

export type HazardStepCallback = (step: HazardReportStep) => void;
export type HazardSkillCallback = (skill: HazardSkillId, output: HazardSkillOutputs[HazardSkillId]) => void;

export interface HazardStreamEvent {
  type: "step" | "skill" | "complete" | "error";
  step?: HazardReportStep;
  skill?: HazardSkillId;
  output?: HazardSkillOutputs[HazardSkillId];
  result?: HazardReportResult;
  error?: string;
}
