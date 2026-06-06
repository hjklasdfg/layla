export const serverEnv = {
  tfl: {
    appKey: process.env.TFL_APP_KEY ?? "",
    appId: process.env.TFL_APP_ID ?? "",
    get enabled() {
      return Boolean(this.appKey);
    },
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
  llmProvider: process.env.LLM_PROVIDER ?? "gemini",
  nemoclaw: {
    inferenceUrl:
      process.env.NEMOCLAW_INFERENCE_URL ?? "http://localhost:18789/v1",
    apiKey: process.env.NEMOCLAW_API_KEY ?? "",
    model:
      process.env.NEMOCLAW_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    agentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "",
    get enabled() {
      return Boolean(this.apiKey && this.agentId);
    },
  },
  get voiceMemoryDir() {
    return process.env.VOICE_MEMORY_DIR ?? "./data/voice";
  },
};

export function tflQueryParams(): string {
  const params = new URLSearchParams();
  if (serverEnv.tfl.appKey) params.set("app_key", serverEnv.tfl.appKey);
  if (serverEnv.tfl.appId) params.set("app_id", serverEnv.tfl.appId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
