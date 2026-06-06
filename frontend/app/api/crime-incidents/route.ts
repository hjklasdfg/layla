import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { parseCrimeIncidentCsv } from "@/lib/crime/parse";

const SOURCE_FILE = "open-data/2026-04-city-of-london-street.csv";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), SOURCE_FILE);
    const csv = await readFile(filePath, "utf8");
    const payload = parseCrimeIncidentCsv(csv, SOURCE_FILE);

    return NextResponse.json(payload);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load crime incidents";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
