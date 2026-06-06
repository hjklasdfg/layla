const STORAGE_KEY = "layla_voice_user_id";

/** Stable anonymous id so ElevenLabs + local memory track the same person. */
export function getVoiceUserId(): string {
  if (typeof window === "undefined") return "anonymous";

  const existing =
    localStorage.getItem(STORAGE_KEY)?.trim() ??
    localStorage.getItem("tongsense_voice_user_id")?.trim();
  if (existing) {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, existing);
    }
    return existing;
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
