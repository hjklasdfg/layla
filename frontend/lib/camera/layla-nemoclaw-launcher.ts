import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

import { serverEnv } from "@/lib/config/env";

export interface LaylaNemoclawServerStatus {
  ready: boolean;
  started: boolean;
  demo: boolean;
  url: string;
}

let child: ChildProcess | null = null;
let starting = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHealth(
  url: string
): Promise<{ ok: boolean; service?: string } | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; service?: string };
    if (body.service !== "layla-nemoclaw") return null;
    return { ok: Boolean(body.ok), service: body.service };
  } catch {
    return null;
  }
}

function resolveServerDir(): string {
  const configured = serverEnv.laylaNemoclaw.serverDir;
  if (configured) return configured;
  return path.resolve(process.cwd(), "../backend/layla-nemoclaw");
}

function portFromApiUrl(url: string): number {
  try {
    const parsed = Number(new URL(url).port);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return new URL(url).protocol === "https:" ? 443 : 80;
  } catch {
    return serverEnv.laylaNemoclaw.port;
  }
}

function spawnServer(): ChildProcess {
  const serverDir = resolveServerDir();
  const port = portFromApiUrl(serverEnv.laylaNemoclaw.apiUrl);
  const python = serverEnv.laylaNemoclaw.python;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    LAYLA_NEMOCLAW_DEMO: serverEnv.laylaNemoclaw.demo ? "1" : "0",
    NEMOCLAW_SERVER_QUIET: "1",
  };

  return spawn(python, ["server.py"], {
    cwd: serverDir,
    env,
    detached: false,
    stdio: "ignore",
  });
}

export async function ensureLaylaNemoclawServer(): Promise<LaylaNemoclawServerStatus> {
  const url = serverEnv.laylaNemoclaw.apiUrl;
  if (!url) {
    throw new Error("LAYLA_NEMOCLAW_URL is not configured.");
  }

  const existing = await fetchHealth(url);
  if (existing?.ok) {
    return {
      ready: true,
      started: false,
      demo: serverEnv.laylaNemoclaw.demo,
      url,
    };
  }

  if (!serverEnv.laylaNemoclaw.autoStart) {
    throw new Error(
      "Layla NemoClaw is not running. Start backend/layla-nemoclaw/server.py or set LAYLA_NEMOCLAW_AUTO_START=true."
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

  const deadline = Date.now() + serverEnv.laylaNemoclaw.startupTimeoutMs;
  while (Date.now() < deadline) {
    const health = await fetchHealth(url);
    if (health?.ok) {
      starting = false;
      return {
        ready: true,
        started: true,
        demo: serverEnv.laylaNemoclaw.demo,
        url,
      };
    }
    await sleep(400);
  }

  starting = false;
  throw new Error(
    `Layla NemoClaw did not become ready at ${url} within ${serverEnv.laylaNemoclaw.startupTimeoutMs}ms.`
  );
}
