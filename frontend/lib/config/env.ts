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
    model: readEnv("GEMINI_MODEL") || "gemini-2.5-flash",
    /** Hazard photo analysis — defaults to GEMINI_MODEL */
    visionModel:
      readEnv("GEMINI_VISION_MODEL") ||
      readEnv("GEMINI_MODEL") ||
      "gemini-2.5-flash",
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
  /** Nebius AI Studio — hazard report agent (vision + web search + email draft) */
  nebiusai: {
    apiKey: readEnv("NEBUISAI_API_KEY") || readEnv("NEBIUS_API_KEY"),
    baseUrl:
      readEnv("NEBUISAI_BASE_URL") ||
      readEnv("NEBIUS_BASE_URL") ||
      "https://api.tokenfactory.nebius.com/v1",
    model:
      readEnv("NEBUISAI_MODEL") ||
      readEnv("NEBIUS_MODEL") ||
      "Qwen/Qwen3-32B",
    visionModel:
      readEnv("NEBUISAI_VISION_MODEL") ||
      "Qwen/Qwen2.5-VL-72B-Instruct",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
  llmProvider: readEnv("LLM_PROVIDER") || "gemini",
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
  llmProvider: readEnv("NEXT_PUBLIC_LLM_PROVIDER") || "gemini",
  elevenlabsAgentId: readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID"),
  /** Voice input via ElevenLabs Scribe (set true when ELEVENLABS_API_KEY is configured). */
  voiceEnabled:
    readEnv("NEXT_PUBLIC_VOICE_ENABLED") === "true" ||
    Boolean(readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID")),
} as const;
