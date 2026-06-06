import { NextResponse } from "next/server";
import type { UserPreference } from "@/lib/agent/types";
import { buildMobilityRoutes } from "@/lib/mobilityEngine";
import { isTfLConfigured } from "@/services/tfl/client";
import { TflApiError } from "@/services/tfl/types";

export const maxDuration = 60;

interface RoutesRequestBody {
  from?: string;
  to?: string;
  profile?: UserPreference["profile"];
}

export async function POST(request: Request) {
  if (!isTfLConfigured()) {
    return NextResponse.json(
      {
        error:
          "TfL API key missing. Add TFL_APP_KEY to .env.local and restart the dev server.",
      },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as RoutesRequestBody;
    const from = body.from?.trim();
    const to = body.to?.trim();
    const profile = body.profile ?? "general";

    if (!from || !to) {
      return NextResponse.json(
        { error: "from and to are required" },
        { status: 400 }
      );
    }

    const { routes, osmWarning } = await buildMobilityRoutes(from, to, profile);

    if (routes.length === 0) {
      return NextResponse.json(
        { error: "No routes with map geometry found for these locations." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      routes,
      meta: {
        source: "tfl" as const,
        from,
        to,
        count: routes.length,
        profile,
        osmWarning,
      },
    });
  } catch (err) {
    if (err instanceof TflApiError) {
      const status =
        err.statusCode === 404
          ? 404
          : err.statusCode === 422
            ? 422
            : err.statusCode === 408
              ? 504
              : 502;

      return NextResponse.json({ error: err.message }, { status });
    }

    const message =
      err instanceof Error ? err.message : "Failed to fetch TfL routes";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
