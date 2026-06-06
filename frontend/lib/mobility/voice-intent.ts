import type { UserPreference } from "@/lib/agent/types";

export interface ParsedJourneyIntent {
  start?: string;
  destination?: string;
}

export interface ParsedVoiceIntent {
  journey: ParsedJourneyIntent;
  profile?: UserPreference["profile"];
}

const JOURNEY_HINT =
  /\b(from|to|take me|get me|go to|want to go|need to go|heading to|journey|route|directions)\b/i;

const PROFILE_PATTERNS: Array<{
  profile: UserPreference["profile"];
  pattern: RegExp;
}> = [
  { profile: "blind", pattern: /\b(blind|low vision|visually impaired|can't see|cannot see)\b/i },
  {
    profile: "wheelchair",
    pattern: /\b(wheelchair|wheel chair|mobility scooter|step[- ]free)\b/i,
  },
  { profile: "elderly", pattern: /\b(elderly|older adult|senior)\b/i },
];

/** True when speech likely contains a journey planning request. */
export function isLikelyJourneyRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const parsed = parseJourneyFromSpeech(trimmed);
  if (parsed.start || parsed.destination) {
    return true;
  }
  return JOURNEY_HINT.test(trimmed);
}

/** True when speech has enough detail to run mobility planning (not chitchat). */
export function shouldTriggerMobilityPlan(text: string): boolean {
  const { start, destination } = parseJourneyFromSpeech(text.trim());
  return Boolean(start && destination);
}

export function parseProfileFromSpeech(text: string): UserPreference["profile"] | undefined {
  for (const { profile, pattern } of PROFILE_PATTERNS) {
    if (pattern.test(text)) return profile;
  }
  return undefined;
}

export function parseVoiceIntent(text: string): ParsedVoiceIntent {
  return {
    journey: parseJourneyFromSpeech(text),
    profile: parseProfileFromSpeech(text),
  };
}

/** Local fallback when the backend intent service is unavailable. */
export function parseJourneyFromSpeech(text: string): ParsedJourneyIntent {
  const trimmed = text.trim();
  if (!trimmed) return {};

  const fromTo =
    trimmed.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:[.?!]|$)/i) ??
    trimmed.match(
      /\b(?:want to go|need to go|go)\s+from\s+(.+?)\s+to\s+(.+?)(?:[.?!]|$)/i
    );

  if (fromTo) {
    const start = fromTo[1]?.trim();
    const destination = fromTo[2]?.trim();
    if (start && destination) {
      return { start, destination };
    }
  }

  const destinationOnly = trimmed.match(
    /\b(?:get me to|take me to|go to|need to get to|want to go to|heading to)\s+(.+?)(?:[.?!]|$)/i
  );
  if (destinationOnly?.[1]) {
    return { destination: destinationOnly[1].trim() };
  }

  return {};
}
