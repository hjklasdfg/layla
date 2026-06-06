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

export type HazardStepId =
  | "analyze_photo"
  | "locate_gps"
  | "search_web"
  | "find_authority"
  | "draft_email"
  | "ready";

export type HazardStepStatus = "pending" | "running" | "done" | "error";

export interface HazardReportStep {
  id: HazardStepId;
  label: string;
  status: HazardStepStatus;
  thought?: string;
  detail?: string;
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

export interface HazardStreamEvent {
  type: "step" | "complete" | "error";
  step?: HazardReportStep;
  result?: HazardReportResult;
  error?: string;
}
