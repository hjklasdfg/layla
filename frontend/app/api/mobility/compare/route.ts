import { NextResponse } from "next/server";

/** Persona comparison — overlays one route per persona. Proxies to the layla-routing
 *  backend (/mobility/compare); needs no TfL. */
export async function POST(request: Request) {
  const backend = process.env.BACKEND_API_URL?.trim();
  if (!backend) {
    return NextResponse.json(
      { error: "Persona compare needs BACKEND_API_URL set in .env.local." },
      { status: 503 }
    );
  }
  try {
    const body = (await request.json()) as { journey?: { start?: string; destination?: string } };
    if (!body.journey?.start || !body.journey?.destination) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }
    const res = await fetch(`${backend.replace(/\/$/, "")}/mobility/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journey: body.journey }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Persona compare failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
