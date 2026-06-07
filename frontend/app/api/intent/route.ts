import { NextResponse } from "next/server";

/** Parse a traveller's (ASR) utterance into Layla-routing input via Nemotron.
 *  Points at a local vLLM/NIM OpenAI-compatible endpoint (the DGX Spark). */
const NEMOTRON_URL = (process.env.NEMOTRON_BASE_URL?.trim() || "http://localhost:18000").replace(/\/$/, "");
const MODEL =
  process.env.NEMOTRON_MODEL?.trim() ||
  "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4";

const PROFILES = ["general", "blind", "wheelchair", "elderly", "night_safety"] as const;
const PRIORITIES = ["most_accessible", "fastest", "most_reliable", "least_stressful"] as const;

const SYSTEM =
  "/no_think You convert a traveller's request into JSON for an accessibility router. " +
  'Output ONLY one JSON object: {"start":"<place>","destination":"<place>","profile":"<p>","priority":"<q>"}.\n' +
  "START / DESTINATION:\n" +
  '- "from X" or "starting at X" -> start = X.  "to Y" / "go to Y" / "take me to Y" -> destination = Y. ' +
  "Use the NAMED places exactly as said; word order does not matter (a 'from X' can come after the 'to Y').\n" +
  '- Set start to "current location" ONLY when NO start place is named AND the speaker refers to themselves ' +
  '("from here", "my current location", "where I am", "near me", "my location"). ' +
  "If any start place is named, NEVER use current location.\n" +
  "Examples:\n" +
  '  "go to Bank from Barbican" -> {"start":"Barbican","destination":"Bank","profile":"general","priority":"most_accessible"}\n' +
  '  "from Barbican to Liverpool Street please" -> {"start":"Barbican","destination":"Liverpool Street","profile":"general","priority":"most_accessible"}\n' +
  '  "I use a wheelchair, take me to Bank from here, quickest way" -> {"start":"current location","destination":"Bank","profile":"wheelchair","priority":"fastest"}\n' +
  "PROFILE in [general,blind,wheelchair,elderly,night_safety]: wheelchair user->wheelchair; blind/low-vision->blind; " +
  "elderly/older->elderly; worried about safety or at night->night_safety; otherwise general.\n" +
  "PRIORITY in [most_accessible,fastest,most_reliable,least_stressful]: quick/fast->fastest; safe/avoid crime->most_reliable; " +
  "calm/quiet/less stressful->least_stressful; otherwise most_accessible.";

export async function POST(request: Request) {
  let text = "";
  try {
    ({ text } = (await request.json()) as { text?: string });
  } catch {
    return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${NEMOTRON_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 160,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    // reasoning-parsed models put no-think output in `reasoning`; fall back to it
    const raw: string = msg.content || msg.reasoning || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json(
        { error: "could not parse intent", raw: raw.slice(0, 200) },
        { status: 422 }
      );
    }
    const intent = JSON.parse(match[0]) as Record<string, string>;
    const profile = (PROFILES as readonly string[]).includes(intent.profile)
      ? intent.profile
      : "general";
    const priority = (PRIORITIES as readonly string[]).includes(intent.priority)
      ? intent.priority
      : "most_accessible";
    return NextResponse.json({
      start: intent.start ?? "",
      destination: intent.destination ?? "",
      profile,
      priority,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "intent parse failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
