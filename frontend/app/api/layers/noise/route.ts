import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** Serves the DEFRA road-noise polygons (dB bands) for the map's Noise layer. */
const NOISE_FILE =
  "../backend/NemoClaw/skills/layla-data/noise_road_cityoflondon.geojson";

export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), NOISE_FILE), "utf8");
    return new NextResponse(raw, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load noise layer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
