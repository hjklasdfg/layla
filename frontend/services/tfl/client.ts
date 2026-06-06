import { serverEnv, tflQueryParams } from "@/lib/config/env";
import { TflApiError } from "./types";

const TFL_BASE = "https://api.tfl.gov.uk";
const DEFAULT_TIMEOUT_MS = 20_000;

export async function tflFetch<T>(
  path: string,
  options: { timeoutMs?: number; revalidate?: number } = {}
): Promise<T> {
  if (!serverEnv.tfl.enabled) {
    throw new TflApiError(
      "TfL API key not configured. Set TFL_APP_KEY in .env.local"
    );
  }

  const sep = path.includes("?") ? "&" : "?";
  const qs = tflQueryParams().replace("?", "");
  const url = `${TFL_BASE}${path}${sep}${qs}`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: options.revalidate ?? 0 },
    });

    if (!res.ok) {
      throw new TflApiError(
        `TfL API error ${res.status} for ${path.split("?")[0]}`,
        res.status
      );
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof TflApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TflApiError("TfL API request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function isTfLConfigured(): boolean {
  return serverEnv.tfl.enabled;
}
