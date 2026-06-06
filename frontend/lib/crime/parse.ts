import type { CrimeIncident, CrimeIncidentMeta, CrimeIncidentResponse } from "./types";

export function parseCrimeIncidentCsv(
  csv: string,
  sourceFile: string
): CrimeIncidentResponse {
  const lines = csv.split("\n").filter(Boolean);
  if (lines.length < 2) {
    return { incidents: [], meta: { count: 0, area: sourceFile, month: "" } };
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idxOf = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iCrimeId = idxOf("Crime ID");
  const iMonth = idxOf("Month");
  const iLon = idxOf("Longitude");
  const iLat = idxOf("Latitude");
  const iLocation = idxOf("Location");
  const iCrimeType = idxOf("Crime type");
  const iOutcome = idxOf("Last outcome category");

  const incidents: CrimeIncident[] = [];
  let month = "";

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rowMonth = cols[iMonth]?.trim() ?? "";
    if (rowMonth && !month) month = rowMonth;

    const lat = parseFloat(cols[iLat] ?? "");
    const lng = parseFloat(cols[iLon] ?? "");
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    incidents.push({
      id: cols[iCrimeId]?.trim() ?? String(i),
      category: cols[iCrimeType]?.trim() ?? "Unknown",
      lat,
      lng,
      month: rowMonth,
      location: cols[iLocation]?.trim() ?? "",
    });
  }

  return {
    incidents,
    meta: {
      count: incidents.length,
      area: sourceFile,
      month,
    },
  };
}
