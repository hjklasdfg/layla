import { runHazardReportPipeline } from "@/lib/camera/hazard-agent";
import type { HazardReportRequest, HazardStreamEvent } from "@/lib/camera/types";
import { serverEnv } from "@/lib/config/env";

export const maxDuration = 120;

function sseEncode(event: HazardStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  if (!serverEnv.nebiusai.enabled) {
    return new Response(
      JSON.stringify({
        error: "NEBUISAI_API_KEY missing. Add it to .env.local for hazard reports.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: HazardReportRequest;
  try {
    body = (await request.json()) as HazardReportRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.imageBase64?.trim()) {
    return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.mimeType?.trim()) {
    return new Response(JSON.stringify({ error: "mimeType is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: HazardStreamEvent) => {
        controller.enqueue(sseEncode(event));
      };

      try {
        const result = await runHazardReportPipeline(body, (step) => {
          send({ type: "step", step });
        });
        send({ type: "complete", result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Hazard report failed";
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
