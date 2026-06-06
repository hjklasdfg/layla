import type { UserPreference } from "@/lib/agent/types";
import type { RouteExplanation } from "@/lib/mobility/plan";

const STORAGE_PREFIX = "layla_voice_memory:";
const LEGACY_STORAGE_PREFIX = "tongsense_voice_memory:";
const MAX_MESSAGES = 24;

export interface VoiceMemoryMessage {
  role: "user" | "agent";
  text: string;
  at: string;
}

export interface VoiceLastPlan {
  journey: { start: string; destination: string };
  recommendedRouteId: string;
  uiText: string;
  voiceText: string;
  at: string;
}

export interface VoiceConversationMemory {
  userId: string;
  updatedAt: string;
  messages: VoiceMemoryMessage[];
  lastPlan?: VoiceLastPlan;
  preference?: Pick<UserPreference, "profile" | "priority">;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readStoredMemory(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(storageKey(userId)) ??
    localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${userId}`)
  );
}

export function loadVoiceMemory(userId: string): VoiceConversationMemory {
  if (typeof window === "undefined") {
    return { userId, updatedAt: new Date().toISOString(), messages: [] };
  }

  try {
    const raw = readStoredMemory(userId);
    if (!raw) return { userId, updatedAt: new Date().toISOString(), messages: [] };
    const parsed = JSON.parse(raw) as VoiceConversationMemory;
    return {
      userId,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_MESSAGES) : [],
      lastPlan: parsed.lastPlan,
      preference: parsed.preference,
    };
  } catch {
    return { userId, updatedAt: new Date().toISOString(), messages: [] };
  }
}

export function saveVoiceMemory(memory: VoiceConversationMemory): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    storageKey(memory.userId),
    JSON.stringify({
      ...memory,
      messages: memory.messages.slice(-MAX_MESSAGES),
      updatedAt: new Date().toISOString(),
    })
  );
}

export function appendVoiceMessage(
  userId: string,
  role: VoiceMemoryMessage["role"],
  text: string
): VoiceConversationMemory {
  const trimmed = text.trim();
  if (!trimmed) return loadVoiceMemory(userId);

  const memory = loadVoiceMemory(userId);
  const last = memory.messages.at(-1);
  if (last?.role === role && last.text === trimmed) return memory;

  memory.messages.push({ role, text: trimmed, at: new Date().toISOString() });
  saveVoiceMemory(memory);
  return memory;
}

export function saveVoicePlanMemory(
  userId: string,
  input: {
    journey: { start: string; destination: string };
    recommendedRouteId: string;
    explanation: RouteExplanation;
    preference?: Pick<UserPreference, "profile" | "priority">;
  }
): VoiceConversationMemory {
  const memory = loadVoiceMemory(userId);
  memory.lastPlan = {
    journey: input.journey,
    recommendedRouteId: input.recommendedRouteId,
    uiText: input.explanation.uiText,
    voiceText: input.explanation.voiceText,
    at: new Date().toISOString(),
  };
  if (input.preference) memory.preference = input.preference;
  saveVoiceMemory(memory);
  return memory;
}

export function buildMemoryContext(memory: VoiceConversationMemory): string {
  const lines = [
    "[Layla returning user memory]",
    `User id: ${memory.userId}`,
  ];

  if (memory.preference) {
    lines.push(
      `Mobility profile: ${memory.preference.profile}, priority: ${memory.preference.priority}`
    );
  }

  if (memory.lastPlan) {
    lines.push(
      `Last planned journey: ${memory.lastPlan.journey.start} → ${memory.lastPlan.journey.destination}`,
      `Last recommended route: ${memory.lastPlan.recommendedRouteId}`,
      `Last path explanation: ${memory.lastPlan.uiText.replace(/\*\*/g, "")}`,
      `Last voice explanation: ${memory.lastPlan.voiceText}`
    );
  }

  const recent = memory.messages.slice(-8);
  if (recent.length) {
    lines.push("Recent conversation:");
    for (const msg of recent) {
      lines.push(`- ${msg.role}: ${msg.text}`);
    }
  }

  lines.push(
    "Use this memory for continuity. Greet returning users naturally if you remember prior journeys."
  );

  return lines.join("\n");
}

export function buildMemorySummary(memory: VoiceConversationMemory): string {
  const parts: string[] = [];
  if (memory.lastPlan) {
    parts.push(
      `Last route: ${memory.lastPlan.journey.start} to ${memory.lastPlan.journey.destination} (route ${memory.lastPlan.recommendedRouteId})`
    );
  }
  const recent = memory.messages.slice(-4);
  if (recent.length) {
    parts.push(
      recent.map((m) => `${m.role}: ${m.text}`).join(" | ")
    );
  }
  return parts.join(". ").slice(0, 480);
}
