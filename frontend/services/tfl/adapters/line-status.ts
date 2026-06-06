import type { LegacyLineStatus } from "../types";

/** Mock line status adapter — replace with TfL Line Status API. */
export async function fetchLineStatus(lineIds: string[]): Promise<LegacyLineStatus[]> {
  void lineIds;
  return [];
}

export function getMockLineStatus(routeId: string): LegacyLineStatus[] {
  if (routeId === "A") {
    return [
      { id: "victoria", name: "Victoria line", severity: "minor", delayMinutes: 8 },
      { id: "circle", name: "Circle line", severity: "good" },
    ];
  }
  return [
    { id: "northern", name: "Northern line", severity: "good" },
    { id: "piccadilly", name: "Piccadilly line", severity: "good" },
  ];
}
