import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

import { serverEnv } from "@/lib/config/env";

export interface HazardServerStatus {
  ready: boolean;
  started: boolean;
  demo: boolean;
  mode: string;
  url: string;
}

let child: ChildProcess | null = null;
let starting = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHealth(
  url: string
): Promise<{ ok: boolean; demo?: boolean; mode?: string } | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; demo?: boolean; mode?: string };
    return { ok: Boolean(body.ok), demo: body.demo, mode: body.mode };
  } catch {
    return null;
  }
}

function resolveServerDir(): string {
  const configured = serverEnv.cameraHazard.serverDir;
  if (configured) return configured;
  return path.resolve(process.cwd(), "../backend/camera-hazard");
}

function portFromApiUrl(url: string): number {
  try {
    const parsed = Number(new URL(url).port);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return new URL(url).protocol === "https:" ? 443 : 80;
  } catch {
    return serverEnv.cameraHazard.port;
  }
}

function spawnServer(): ChildProcess {
  const serverDir = resolveServerDir();
  const port = portFromApiUrl(serverEnv.cameraHazard.apiUrl);
  const python = serverEnv.cameraHazard.python;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    CAMERA_HAZARD_DEMO: serverEnv.cameraHazard.demo ? "1" : "0",
    YOLO_MODEL: serverEnv.cameraHazard.yoloModel,
  };

  if (serverEnv.cameraHazard.demo) {
    env.CAMERA_HAZARD_DEMO_SCENARIO = serverEnv.cameraHazard.demoScenario;
  }

  return spawn(python, ["server.py"], {
    cwd: serverDir,
    env,
    detached: false,
    stdio: "ignore",
  });
}

export async function ensureCameraHazardServer(): Promise<HazardServerStatus> {
  const url = serverEnv.cameraHazard.apiUrl;
  if (!url) {
    throw new Error("CAMERA_HAZARD_API_URL is not configured.");
  }

  const existing = await fetchHealth(url);
  if (existing?.ok) {
    return {
      ready: true,
      started: false,
      demo: Boolean(existing.demo),
      mode: existing.mode ?? (existing.demo ? "demo" : "yolo"),
      url,
    };
  }

  if (!serverEnv.cameraHazard.autoStart) {
    throw new Error(
      "Live hazard watch service is not running. Start backend/camera-hazard/server.py or set CAMERA_HAZARD_AUTO_START=true."
    );
  }

  if (!starting && (!child || child.exitCode !== null)) {
    starting = true;
    child = spawnServer();
    child.on("exit", () => {
      if (child?.exitCode !== null && child?.exitCode !== 0) {
        child = null;
      }
      starting = false;
    });
  }

  const deadline = Date.now() + serverEnv.cameraHazard.startupTimeoutMs;
  while (Date.now() < deadline) {
    const health = await fetchHealth(url);
    if (health?.ok) {
      starting = false;
      return {
        ready: true,
        started: true,
        demo: Boolean(health.demo),
        mode: health.mode ?? (health.demo ? "demo" : "yolo"),
        url,
      };
    }
    await sleep(400);
  }

  starting = false;
  throw new Error(
    `Camera hazard service did not become ready at ${url} within ${serverEnv.cameraHazard.startupTimeoutMs}ms.`
  );
}
