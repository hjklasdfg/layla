import { NextResponse } from "next/server";
import { analyzeHazardAndReport } from "@/lib/camera/hazard-agent";
import type { HazardReportRequest } from "@/lib/camera/types";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!serverEnv.gemini.enabled) {
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY missing. Add it to .env.local for hazard photo analysis.",
      },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as HazardReportRequest;

    if (!body.imageBase64?.trim()) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    if (!body.mimeType?.trim()) {
      return NextResponse.json({ error: "mimeType is required" }, { status: 400 });
    }

    const result = await analyzeHazardAndReport(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hazard report failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
