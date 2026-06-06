import type { RouteContext } from "./route-store";

const VOICE_PERSONA = `You are TongSense, an accessibility-aware journey guide for London.
You help users navigate the city safely, with special attention to their mobility needs.

CRITICAL VOICE RULES — follow these on every single response:
- Maximum 2 sentences per response. Never more.
- Spoken English only. No markdown, no bullet points, no headers, no lists, no code.
- Do not say "certainly", "absolutely", "of course", "great question", or similar filler.
- Be direct and warm. You are a knowledgeable local guide, not a chatbot.
- If you do not know something, say so in one sentence.

When you learn something about the user (accessibility needs, preferences, frequent
destinations), remember it — you will never ask the same question twice.`;

const MAP_COMMAND_INSTRUCTIONS = `When you need to update the map (show routes, highlight a route, mark a hazard),
emit a JSON command on its own line in this exact format:
{"map_command":"show_routes","from":"<origin>","to":"<destination>"}
{"map_command":"highlight_route","routeId":"A"}
{"map_command":"show_hazard","lat":51.5074,"lng":-0.1278,"label":"lift out of service"}

The user will not see these commands — they are processed by the app automatically.
Always emit the map_command BEFORE the spoken response text.`;

export function formatRouteContext(ctx: RouteContext): string {
  if (!ctx.from || !ctx.to) return "No active route";

  const lines: string[] = [
    `From: ${ctx.from} → To: ${ctx.to}`,
  ];

  if (ctx.routes?.length) {
    lines.push("Routes available:");
    for (const r of ctx.routes) {
      const stepFreeNote = r.stepFree ? "step-free throughout" : "not fully step-free";
      lines.push(
        `  Route ${r.id}: ${r.durationMinutes} min, ${stepFreeNote}, accessibility score ${r.accessibilityScore}/100`
      );
    }
  }

  if (ctx.recommendation) {
    lines.push(`Current recommendation: Route ${ctx.recommendation}`);
  }

  if (ctx.alerts?.length) {
    lines.push("Live alerts: " + ctx.alerts.join("; "));
  }

  return lines.join("\n");
}

export function buildSystemPrompt(
  memory: string,
  routeContext: RouteContext | null
): string {
  const parts = [VOICE_PERSONA];

  if (memory) {
    parts.push(`<memory>\n${memory}\n</memory>`);
  }

  if (routeContext) {
    parts.push(`<current-map>\n${formatRouteContext(routeContext)}\n</current-map>`);
  }

  parts.push(MAP_COMMAND_INSTRUCTIONS);

  return parts.join("\n\n");
}
