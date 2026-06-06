import "server-only";

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? "";
}

export const serverEnv = {
  tfl: {
    appKey: readEnv("TFL_APP_KEY"),
    appId: readEnv("TFL_APP_ID"),
    get enabled() {
      return Boolean(this.appKey);
    },
  },
  osm: {
    userAgent: readEnv("OSM_USER_AGENT") || "Layla/0.1 (accessibility mobility)",
  },
  gemini: {
    apiKey: readEnv("GEMINI_API_KEY"),
    model: readEnv("GEMINI_MODEL") || "gemini-2.0-flash",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
  nemotron: {
    baseUrl:
      readEnv("NEMOTRON_BASE_URL") ||
      "https://theory-refresh-soma-provisions.trycloudflare.com",
    model:
      readEnv("NEMOTRON_MODEL") ||
      "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
    apiKey: readEnv("NEMOTRON_API_KEY"),
    get enabled() {
      return Boolean(this.baseUrl);
    },
  },
  llmProvider: readEnv("LLM_PROVIDER") || "nemotron",
  backend: {
    apiUrl: readEnv("BACKEND_API_URL"),
    apiKey: readEnv("BACKEND_API_KEY"),
    get enabled() {
      return Boolean(this.apiUrl);
    },
  },
  elevenlabs: {
    apiKey: readEnv("ELEVENLABS_API_KEY"),
    agentId: readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID"),
    get sttEnabled() {
      return Boolean(this.apiKey);
    },
    get enabled() {
      return Boolean(this.apiKey && this.agentId);
    },
  },
} as const;

export function tflQueryParams(): string {
  const params = new URLSearchParams();
  if (serverEnv.tfl.appKey) params.set("app_key", serverEnv.tfl.appKey);
  if (serverEnv.tfl.appId) params.set("app_id", serverEnv.tfl.appId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const publicEnv = {
  llmProvider: readEnv("NEXT_PUBLIC_LLM_PROVIDER") || "nemotron",
  elevenlabsAgentId: readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID"),
  /** Voice input via ElevenLabs Scribe (set true when ELEVENLABS_API_KEY is configured). */
  voiceEnabled:
    readEnv("NEXT_PUBLIC_VOICE_ENABLED") === "true" ||
    Boolean(readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID")),
} as const;
