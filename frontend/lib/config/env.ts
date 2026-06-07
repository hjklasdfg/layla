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
  /** Standalone Layla NemoClaw hazard report (backend/layla-nemoclaw). Tried before Nebius. */
  laylaNemoclaw: {
    apiUrl:
      readEnv("LAYLA_NEMOCLAW_URL") ||
      readEnv("HAZARD_REPORT_AGENT_URL") ||
      (readEnv("LAYLA_NEMOCLAW_AUTO_START") !== "false" &&
      readEnv("HAZARD_REPORT_AGENT_AUTO_START") !== "false"
        ? "http://127.0.0.1:8002"
        : ""),
    autoStart:
      readEnv("LAYLA_NEMOCLAW_AUTO_START") !== "false" &&
      readEnv("HAZARD_REPORT_AGENT_AUTO_START") !== "false",
    demo: ["1", "true", "yes"].includes(
      (
        readEnv("LAYLA_NEMOCLAW_DEMO") ||
        readEnv("HAZARD_REPORT_AGENT_DEMO") ||
        readEnv("LAYLA_HAZARD_DEMO")
      ).toLowerCase()
    ),
    serverDir:
      readEnv("LAYLA_NEMOCLAW_SERVER_DIR") || readEnv("HAZARD_REPORT_AGENT_SERVER_DIR"),
    python:
      readEnv("LAYLA_NEMOCLAW_PYTHON") ||
      readEnv("HAZARD_REPORT_AGENT_PYTHON") ||
      "python3",
    port:
      Number(readEnv("LAYLA_NEMOCLAW_PORT") || readEnv("HAZARD_REPORT_AGENT_PORT")) ||
      8002,
    startupTimeoutMs:
      Number(
        readEnv("LAYLA_NEMOCLAW_STARTUP_TIMEOUT_MS") ||
          readEnv("HAZARD_REPORT_AGENT_STARTUP_TIMEOUT_MS")
      ) || 60_000,
    get enabled() {
      return Boolean(this.apiUrl);
    },
  },
  /** Standalone live hazard watch (backend/camera-hazard) — separate from hazard report. */
  cameraHazard: {
    /** Real camera chunks + fake hazard JSON (no GPU backend) — loop/UI test. */
    get fakeLoop() {
      const v = readEnv("CAMERA_HAZARD_FAKE_LOOP").toLowerCase();
      return v === "1" || v === "true" || v === "yes";
    },
    get autoStart() {
      return readEnv("CAMERA_HAZARD_AUTO_START") !== "false";
    },
    get demo() {
      const v = readEnv("CAMERA_HAZARD_DEMO").toLowerCase();
      return v === "1" || v === "true" || v === "yes";
    },
    demoScenario: readEnv("CAMERA_HAZARD_DEMO_SCENARIO") || "alternate",
    yoloModel: readEnv("YOLO_MODEL") || "yolo11n.pt",
    apiUrl:
      readEnv("CAMERA_HAZARD_API_URL") ||
      (readEnv("CAMERA_HAZARD_AUTO_START") !== "false" ? "http://127.0.0.1:8001" : ""),
    apiKey: readEnv("CAMERA_HAZARD_API_KEY"),
    serverDir: readEnv("CAMERA_HAZARD_SERVER_DIR"),
    python: readEnv("CAMERA_HAZARD_PYTHON") || "python3",
    port: Number(readEnv("CAMERA_HAZARD_PORT")) || 8001,
    startupTimeoutMs: Number(readEnv("CAMERA_HAZARD_STARTUP_TIMEOUT_MS")) || 60_000,
    /** Landmark id for pretend GPS when reporting without browser location (e.g. st-pancras). */
    hazardReportFallbackLocation: readEnv("HAZARD_REPORT_FALLBACK_LOCATION"),
    get enabled() {
      return this.fakeLoop || Boolean(this.apiUrl);
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
  // OpenClaw gateway (the always-on agent). The /api/voice/chat adapter bridges
  // ElevenLabs Custom-LLM (OpenAI chat-completions SSE) to this gateway's
  // WebSocket RPC. The agent runs on the same DGX host; the token comes from
  // <openclaw home>/openclaw.json -> gateway.auth.token.
  openclaw: {
    gatewayUrl: readEnv("OPENCLAW_GATEWAY_URL") || "ws://127.0.0.1:18789/ws",
    gatewayToken: readEnv("OPENCLAW_GATEWAY_TOKEN"),
    model: readEnv("OPENCLAW_MODEL") || "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
    get enabled() {
      return Boolean(this.gatewayUrl);
    },
  },
  // Shared secret ElevenLabs Custom-LLM sends as `Authorization: Bearer <secret>`
  // on every /api/voice/chat call. Empty = endpoint open (dev only — never in
  // production behind a public tunnel).
  voice: {
    chatSecret: readEnv("VOICE_CHAT_SECRET"),
    get authRequired() {
      return Boolean(this.chatSecret);
    },
    // Voice LLM backend: "model" = stream directly from a fast OpenAI-compatible
    // model (low latency, no agent loop); "openclaw" = route through the OpenClaw
    // agent (tools/memory, but ~20-30s — exceeds ElevenLabs' 15s cap).
    backend: readEnv("VOICE_BACKEND") || "model",
    modelUrl: readEnv("VOICE_MODEL_URL") || "http://127.0.0.1:8000/v1",
    model: readEnv("VOICE_MODEL") || "nvidia/Nemotron-3-Nano-Omni-30B",
    get modelMaxTokens() {
      const n = Number(readEnv("VOICE_MODEL_MAX_TOKENS"));
      return Number.isFinite(n) && n > 0 ? n : 1024;
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
  /**
   * Voice transport: "conversational" = ElevenLabs Conversational AI (full-duplex,
   * routed through the OpenClaw agent via /api/voice/chat); "scribe" = legacy
   * push-to-talk STT. Defaults to scribe until Conversational AI is proven (A6).
   */
  voiceMode:
    readEnv("NEXT_PUBLIC_VOICE_MODE") === "conversational"
      ? ("conversational" as const)
      : ("scribe" as const),
} as const;
