import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { serverEnv } from "@/lib/config/env";

function memoryPath(sessionId: string): string {
  return join(serverEnv.voiceMemoryDir, `memory-${sessionId}.md`);
}

export async function loadMemory(sessionId: string): Promise<string> {
  try {
    return await readFile(memoryPath(sessionId), "utf-8");
  } catch {
    return "";
  }
}

export async function appendFacts(
  sessionId: string,
  facts: string[]
): Promise<void> {
  if (facts.length === 0) return;

  const existing = await loadMemory(sessionId);
  const newFacts = facts.filter((f) => !existing.includes(f));
  if (newFacts.length === 0) return;

  await mkdir(serverEnv.voiceMemoryDir, { recursive: true });

  let content: string;
  if (!existing) {
    content = `# User Memory\n\n${newFacts.map((f) => `- ${f}`).join("\n")}\n`;
  } else {
    content = existing.trimEnd() + "\n" + newFacts.map((f) => `- ${f}`).join("\n") + "\n";
  }

  await writeFile(memoryPath(sessionId), content, "utf-8");
}

export async function extractAndSaveMemory(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  assistantResponse: string
): Promise<void> {
  const { serverEnv: env } = await import("@/lib/config/env");
  if (!env.nemoclaw.enabled) return;

  const existing = await loadMemory(sessionId);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  const extractionPrompt = [
    {
      role: "system",
      content: `You are a memory extraction assistant. Given a conversation turn, identify any NEW facts about the user that should be remembered for future conversations.\n\nReturn ONLY valid JSON in this exact format:\n{"new_facts": ["fact1", "fact2"]}\n\nReturn {"new_facts": []} if no new facts are present.\nDo NOT repeat facts that are already in the existing memory.\nDo NOT include route-specific details that will change next session.\nDO include: mobility needs, accessibility requirements, preferences, frequent locations.\n\nExisting memory:\n${existing || "(none)"}`,
    },
    {
      role: "user",
      content: `Last user message: "${lastUser?.content ?? ""}"\nLast assistant message: "${assistantResponse}"`,
    },
  ];

  try {
    const res = await fetch(
      `${env.nemoclaw.inferenceUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.nemoclaw.apiKey}`,
        },
        body: JSON.stringify({
          model: env.nemoclaw.model,
          messages: extractionPrompt,
          temperature: 0,
          max_tokens: 128,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!res.ok) return;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { new_facts?: string[] };
    const newFacts = parsed.new_facts ?? [];

    if (newFacts.length > 0) {
      await appendFacts(sessionId, newFacts);
    }
  } catch {
    // fire-and-forget — never crash the voice stream on memory failure
  }
}
