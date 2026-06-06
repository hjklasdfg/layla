import { NextResponse } from "next/server";
import { fetchBackendJourneyIntent } from "@/lib/agent/providers/backend";
import type { UserPreference } from "@/lib/agent/types";
import { requestBackendMobilityPlan } from "@/lib/mobility/backend-plan";
import { buildTflJourneyPayload } from "@/lib/mobility/backend-plan-types";
import type { CameraDataItem, GpsLocation } from "@/lib/mobility/sensors";
import { parseJourneyFromSpeech } from "@/lib/mobility/voice-intent";
import { getJourneys } from "@/services/tfl/journey";
import { resolveJourneyEndpoints } from "@/services/tfl/resolveLocation";
import { isTfLConfigured } from "@/services/tfl/client";
import { TflApiError } from "@/services/tfl/types";

export const maxDuration = 120;

interface MobilityPlanRequest {
  audioInput?: string;
  gps?: GpsLocation | null;
  cameraData?: CameraDataItem[];
  preference: UserPreference;
  journey?: {
    start?: string;
    destination?: string;
  };
}

async function resolveJourney(
  body: MobilityPlanRequest
): Promise<{ start: string; destination: string } | null> {
  let start = body.journey?.start?.trim();
  let destination = body.journey?.destination?.trim();

  if ((!start || !destination) && body.audioInput?.trim()) {
    const backendIntent = await fetchBackendJourneyIntent(body.audioInput, body.gps);
    start = start || backendIntent.start?.trim();
    destination = destination || backendIntent.destination?.trim();

    if (!start || !destination) {
      const localIntent = parseJourneyFromSpeech(body.audioInput);
      start = start || localIntent.start?.trim();
      destination = destination || localIntent.destination?.trim();
    }
  }

  if (!start || !destination) return null;
  return { start, destination };
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
    const body = (await request.json()) as MobilityPlanRequest;

    if (!body.preference?.profile || !body.preference?.priority) {
      return NextResponse.json({ error: "preference is required" }, { status: 400 });
    }

    const journey = await resolveJourney(body);
    if (!journey) {
      return NextResponse.json(
        {
          error:
            "Could not determine journey from/to. Say something like “from King's Cross to Victoria”.",
        },
        { status: 422 }
      );
    }

    const endpoints = await resolveJourneyEndpoints(journey.start, journey.destination);

    const tflCandidates = await getJourneys(journey.start, journey.destination, {
      fromSegment: endpoints.from.segment,
      toSegment: endpoints.to.segment,
    });

    if (!tflCandidates.length) {
      return NextResponse.json({ error: "No TfL journeys found." }, { status: 404 });
    }

    const journeyAnchors = {
      start: endpoints.from.point,
      end: endpoints.to.point,
    };

    const plan = await requestBackendMobilityPlan({
      audioInput: body.audioInput,
      gps: body.gps ?? null,
      cameraData: body.cameraData ?? [],
      preference: body.preference,
      journey,
      journeyAnchors,
      tflJourney: buildTflJourneyPayload(
        journey.start,
        journey.destination,
        tflCandidates
      ),
    });

    return NextResponse.json({
      ...plan,
      meta: {
        ...plan.meta,
        ...(endpoints.from.point ? { startPoint: endpoints.from.point } : {}),
        ...(endpoints.to.point ? { endPoint: endpoints.to.point } : {}),
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

    const message = err instanceof Error ? err.message : "Mobility plan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
