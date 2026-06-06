import { NextResponse } from "next/server";

const VALHALLA_TRACE_URL =
  process.env.VALHALLA_URL?.replace(/\/$/, "") ??
  "https://valhalla1.openstreetmap.de";

interface TraceRequest {
  /** Path as [lng, lat] pairs (matches our skill's path_lonlat output) */
  path_lonlat?: Array<[number, number]>;
  /** Or as {lat, lng} pairs */
  shape?: Array<{ lat: number; lng: number }>;
  language?: string;
}

export async function POST(request: Request) {
  let body: TraceRequest;
  try {
    body = (await request.json()) as TraceRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize input — accept either path_lonlat (from skill) or shape ({lat,lng})
  let shape: Array<{ lat: number; lon: number }>;
  if (body.path_lonlat?.length) {
    shape = body.path_lonlat.map(([lng, lat]) => ({ lat, lon: lng }));
  } else if (body.shape?.length) {
    shape = body.shape.map((p) => ({ lat: p.lat, lon: p.lng }));
  } else {
    return NextResponse.json(
      { error: "path_lonlat or shape required" },
      { status: 400 }
    );
  }

  if (shape.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 points" },
      { status: 400 }
    );
  }

  const valhallaBody = {
    shape,
    costing: "pedestrian",
    shape_match: "map_snap",
    directions_options: {
      units: "kilometers",
      language: body.language ?? "en-US",
    },
  };

  try {
    const res = await fetch(`${VALHALLA_TRACE_URL}/trace_route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valhallaBody),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Valhalla error ${res.status}: ${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "trace_route failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
