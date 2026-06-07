import { NextResponse } from "next/server";

/** "Ask Layla anything" — Nemotron picks what data to look up, the backend
 *  fetches it from the open-data layers, Nemotron answers in plain language. */
const NEMOTRON_URL = (process.env.NEMOTRON_BASE_URL?.trim() || "http://localhost:18000").replace(/\/$/, "");
const MODEL =
  process.env.NEMOTRON_MODEL?.trim() ||
  "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4";
const BACKEND = process.env.BACKEND_API_URL?.trim();

async function nemotron(system: string, user: string, maxTokens = 220): Promise<string> {
  const res = await fetch(`${NEMOTRON_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const d = await res.json();
  const m = d?.choices?.[0]?.message ?? {};
  return ((m.content || m.reasoning || "") as string).trim();
}

export async function POST(request: Request) {
  let question = "";
  try {
    ({ question } = (await request.json()) as { question?: string });
  } catch {
    return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  }
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (!BACKEND) {
    return NextResponse.json({ error: "BACKEND_API_URL not configured" }, { status: 503 });
  }

  try {
    // 1) Nemotron: what is this about? -> {place, transit}
    const raw = await nemotron(
      "/no_think Extract from the traveller's question, as ONE JSON object only: " +
        '{"place": "<a London place name in the question, or empty>", ' +
        '"transit": true|false (is it about tube/bus/train/line service or delays?)}.',
      question,
      120
    );
    let place = "";
    let transit = false;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]) as { place?: string; transit?: boolean };
        place = (j.place || "").trim();
        transit = Boolean(j.transit);
      } catch {
        /* fall through with defaults */
      }
    }

    // 2) backend: fetch the relevant open-data layers
    const look = await fetch(`${BACKEND.replace(/\/$/, "")}/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place, transit }),
    });
    const data = await look.json();

    // 3) Nemotron: answer using ONLY that data
    const answer = await nemotron(
      "/no_think You are Layla, a warm London accessibility & mobility assistant. " +
        "Answer the question in 1-2 short sentences using ONLY the DATA provided. " +
        "Use concrete numbers when present (crime count nearby, noise dB, tactile-paving / " +
        "crossing / step counts, line status). Interpret honestly: a HIGH nearby-crime count " +
        "means LESS safe (don't sugar-coat); more tactile paving / step-free crossings means more " +
        "accessible; higher dB means noisier. If the DATA doesn't cover it, say you don't have " +
        "that yet — never invent.",
      `Question: ${question}\nDATA: ${JSON.stringify(data)}`,
      240
    );

    return NextResponse.json({ answer, place, transit, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ask failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
