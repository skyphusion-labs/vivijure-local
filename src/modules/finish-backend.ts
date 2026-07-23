/** FINISH_BACKEND routing (local#180): homelab finish GPU via LOCAL_FINISH_*_URL or RunPod escape hatch. */

export type FinishBackendMode = "local" | "runpod";

export interface FinishBackendEnv {
  FINISH_BACKEND?: string;
  FINISH_RIFE_BACKEND?: string;
  FINISH_LIPSYNC_BACKEND?: string;
  FINISH_UPSCALE_BACKEND?: string;
  LOCAL_FINISH_RIFE_URL?: string;
  LOCAL_FINISH_LIPSYNC_URL?: string;
  LOCAL_FINISH_UPSCALE_URL?: string;
  LOCAL_FINISH_TOKEN?: string;
}

const MODULE_BACKEND_KEY: Record<string, keyof FinishBackendEnv> = {
  "finish-rife": "FINISH_RIFE_BACKEND",
  "finish-lipsync": "FINISH_LIPSYNC_BACKEND",
  "finish-upscale": "FINISH_UPSCALE_BACKEND",
};

const MODULE_LOCAL_URL_KEY: Record<string, keyof FinishBackendEnv> = {
  "finish-rife": "LOCAL_FINISH_RIFE_URL",
  "finish-lipsync": "LOCAL_FINISH_LIPSYNC_URL",
  "finish-upscale": "LOCAL_FINISH_UPSCALE_URL",
};

export function finishBackendFromProcess(env: NodeJS.ProcessEnv): FinishBackendEnv {
  return {
    FINISH_BACKEND: env.FINISH_BACKEND?.trim() || undefined,
    FINISH_RIFE_BACKEND: env.FINISH_RIFE_BACKEND?.trim() || undefined,
    FINISH_LIPSYNC_BACKEND: env.FINISH_LIPSYNC_BACKEND?.trim() || undefined,
    FINISH_UPSCALE_BACKEND: env.FINISH_UPSCALE_BACKEND?.trim() || undefined,
    LOCAL_FINISH_RIFE_URL: env.LOCAL_FINISH_RIFE_URL?.trim() || undefined,
    LOCAL_FINISH_LIPSYNC_URL: env.LOCAL_FINISH_LIPSYNC_URL?.trim() || undefined,
    LOCAL_FINISH_UPSCALE_URL: env.LOCAL_FINISH_UPSCALE_URL?.trim() || undefined,
    LOCAL_FINISH_TOKEN: env.LOCAL_FINISH_TOKEN?.trim() || undefined,
  };
}

function parseMode(raw: string | undefined, fallback: FinishBackendMode): FinishBackendMode {
  const v = raw?.trim().toLowerCase();
  if (v === "local" || v === "runpod") return v;
  return fallback;
}

/** Default runpod until homelab cutover; set FINISH_BACKEND=local on propagandhi after local finish HTTP lands. */
export function resolveFinishBackend(moduleName: string, env: FinishBackendEnv): FinishBackendMode {
  const globalDefault = parseMode(env.FINISH_BACKEND, "runpod");
  const overrideKey = MODULE_BACKEND_KEY[moduleName];
  const override = overrideKey ? parseMode(env[overrideKey], globalDefault) : globalDefault;
  return override;
}

export function normalizeFinishBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function localFinishUrlFor(moduleName: string, env: FinishBackendEnv): string | null {
  const key = MODULE_LOCAL_URL_KEY[moduleName];
  if (!key) return null;
  const raw = env[key];
  if (typeof raw !== "string") return null;
  return normalizeFinishBaseUrl(raw);
}

export function localFinishConfigured(moduleName: string, env: FinishBackendEnv): boolean {
  return localFinishUrlFor(moduleName, env) != null;
}
