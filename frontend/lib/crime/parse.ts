import type { CrimeIncidentResponse } from "./types";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

export function parseCrimeIncidentCsv(
  csv: string,
  sourceFile: string
): CrimeIncidentResponse {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return {
      incidents: [],
      meta: {
        sourceFile,
        totalRows: 0,
        mappedCount: 0,
        unmappedCount: 0,
      },
    };
  }

  const header = parseCsvLine(lines[0]);
  const indexOf = (name: string) =>
    header.findIndex((col) => col.toLowerCase() === name.toLowerCase());

  const idx = {
    crimeId: indexOf("Crime ID"),
    month: indexOf("Month"),
    longitude: indexOf("Longitude"),
    latitude: indexOf("Latitude"),
    location: indexOf("Location"),
    crimeType: indexOf("Crime type"),
    outcome: indexOf("Last outcome category"),
  };

  const incidents = [];
  let mappedCount = 0;
  let unmappedCount = 0;

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const lat = parseFloat(cols[idx.latitude] ?? "");
    const lng = parseFloat(cols[idx.longitude] ?? "");

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      unmappedCount += 1;
      continue;
    }

    mappedCount += 1;
    incidents.push({
      crimeId: cols[idx.crimeId] ?? "",
      month: cols[idx.month] ?? "",
      latitude: lat,
      longitude: lng,
      location: cols[idx.location] ?? "Unknown location",
      crimeType: cols[idx.crimeType] ?? "Other crime",
      outcome: cols[idx.outcome] ?? "Unknown",
    });
  }

  return {
    incidents,
    meta: {
      sourceFile,
      totalRows: lines.length - 1,
      mappedCount,
      unmappedCount,
    },
  };
}
