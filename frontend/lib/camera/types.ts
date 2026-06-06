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

export interface HazardReportResult {
  analysis: HazardAnalysis;
  authority: AuthorityContact;
  email: HazardReportEmail;
  emailSent: boolean;
  emailStatus: string;
  searchSummary?: string;
}

export interface HazardReportRequest {
  imageBase64: string;
  mimeType: string;
  gps?: GpsLocation | null;
  locationDescription?: string;
}
