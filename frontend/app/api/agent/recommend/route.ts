import { NextResponse } from "next/server";
import { generateMobilityRecommendationServer } from "@/lib/agent/server-recommend";
import type { MobilityAgentContext } from "@/lib/agent/types";
import { serverEnv } from "@/lib/config/env";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { context?: MobilityAgentContext };

    if (!body.context?.routes?.length) {
      return NextResponse.json({ error: "context.routes is required" }, { status: 400 });
    }

    const recommendation = await generateMobilityRecommendationServer(body.context);

    return NextResponse.json(recommendation);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent request failed";

    if (serverEnv.llmProvider === "gemini" && !serverEnv.gemini.enabled) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY missing. Copy .env.local.example to .env.local and add your key.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
