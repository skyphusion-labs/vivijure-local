/** FINISH_BACKEND routing (local#180): homelab finish GPU via LOCAL_FINISH_*_URL, RunPod opt-in.
 *
 * Local RIFE is NOT supported (Conrad 2026-07-28): there is no vivijure-local finish-rife image
 * and no LOCAL_FINISH_RIFE_URL path. RIFE, when wanted, is RunPod-only (vivijure-cf / opt-in).
 */

export type FinishBackendMode = "local" | "runpod";

export interface FinishBackendEnv {
  FINISH_BACKEND?: string;
  FINISH_LIPSYNC_BACKEND?: string;
  FINISH_UPSCALE_BACKEND?: string;
  LOCAL_FINISH_LIPSYNC_URL?: string;
  LOCAL_FINISH_UPSCALE_URL?: string;
  LOCAL_FINISH_TOKEN?: string;
  /** Homelab sequential VRAM: unload before local finish GPU jobs (local#265). */
  OLLAMA_BASE_URL?: string;
  OLLAMA_PLAN_MODEL?: string;
}

const MODULE_BACKEND_KEY: Record<string, keyof FinishBackendEnv> = {
  "finish-lipsync": "FINISH_LIPSYNC_BACKEND",
  "finish-upscale": "FINISH_UPSCALE_BACKEND",
};

const MODULE_LOCAL_URL_KEY: Record<string, keyof FinishBackendEnv> = {
  "finish-lipsync": "LOCAL_FINISH_LIPSYNC_URL",
  "finish-upscale": "LOCAL_FINISH_UPSCALE_URL",
};

export function finishBackendFromProcess(env: NodeJS.ProcessEnv): FinishBackendEnv {
  return {
    FINISH_BACKEND: env.FINISH_BACKEND?.trim() || undefined,
    FINISH_LIPSYNC_BACKEND: env.FINISH_LIPSYNC_BACKEND?.trim() || undefined,
    FINISH_UPSCALE_BACKEND: env.FINISH_UPSCALE_BACKEND?.trim() || undefined,
    LOCAL_FINISH_LIPSYNC_URL: env.LOCAL_FINISH_LIPSYNC_URL?.trim() || undefined,
    LOCAL_FINISH_UPSCALE_URL: env.LOCAL_FINISH_UPSCALE_URL?.trim() || undefined,
    LOCAL_FINISH_TOKEN: env.LOCAL_FINISH_TOKEN?.trim() || undefined,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL?.trim() || undefined,
    OLLAMA_PLAN_MODEL: env.OLLAMA_PLAN_MODEL?.trim() || undefined,
  };
}

function parseMode(raw: string | undefined, fallback: FinishBackendMode): FinishBackendMode {
  const v = raw?.trim().toLowerCase();
  if (v === "local" || v === "runpod") return v;
  return fallback;
}

/**
 * DEFAULT IS `local` (local#229, epic local#200): this is the self-hosted panel, so an operator who
 * never set FINISH_BACKEND gets the local path.
 *
 * It used to default to `runpod`, which meant bringing up the finish satellites without setting the
 * variable dispatched homelab finish jobs to RunPod -- a cloud call nobody asked for, on the host
 * whose whole premise is that RunPod is opt-in. Unconfigured `local` now refuses by name
 * (`LOCAL_FINISH_*_URL is unset`, see local-finish/handlers.ts) instead of silently reaching for a
 * credential the operator may not even have. RunPod stays fully supported, explicitly:
 * FINISH_BACKEND=runpod, or the per-module FINISH_*_BACKEND override.
 */
export function resolveFinishBackend(moduleName: string, env: FinishBackendEnv): FinishBackendMode {
  // finish-rife has no local path; always RunPod when this resolver is asked about it.
  if (moduleName === "finish-rife") return "runpod";
  const globalDefault = parseMode(env.FINISH_BACKEND, "local");
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

/** A resolved door pool plus what it cost to resolve it (local#378). */
export interface FinishDoorSet {
  /** Usable, normalised, de-duplicated door base URLs, in declaration order. */
  urls: string[];
  /** Entries present in the raw value that did NOT become a usable door.
   *
   *  SURFACED RATHER THAN SWALLOWED, deliberately: a silently shortened pool is a capacity
   *  halving nobody sees. One typo in a two-door list is a 50% loss that no error reports. */
  dropped: number;
}

/**
 * Parse a COMMA-SEPARATED door list. Same variable as before (local#378) -- no new env key.
 *
 * A single value parses to a one-element list with `dropped: 0`, so every existing deployment is
 * bit-for-bit unaffected. `normalizeFinishBaseUrl` keeps its exact contract and its tests; this is
 * additive and delegates to it per entry, so the two can never disagree about what a valid URL is.
 *
 * An INVALID ENTRY IS DROPPED rather than failing the whole list: one bad door must not take a
 * healthy one down with it. An all-invalid list returns `urls: []`, which `localFinishConfigured`
 * reads as NOT configured -- the same state as unset, which is correct, because a list that
 * resolves to no door configures nothing.
 */
export function normalizeFinishBaseUrls(raw: string): FinishDoorSet {
  const urls: string[] = [];
  let dropped = 0;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue; // a trailing comma is sloppiness, not a lost door
    const normalized = normalizeFinishBaseUrl(trimmed);
    if (!normalized) {
      dropped += 1;
      continue;
    }
    if (!urls.includes(normalized)) urls.push(normalized); // same door twice is one door
  }
  return { urls, dropped };
}

export function localFinishUrlsFor(moduleName: string, env: FinishBackendEnv): FinishDoorSet {
  const key = MODULE_LOCAL_URL_KEY[moduleName];
  if (!key) return { urls: [], dropped: 0 };
  const raw = env[key];
  if (typeof raw !== "string") return { urls: [], dropped: 0 };
  return normalizeFinishBaseUrls(raw);
}

/**
 * The FIRST usable door, or null. Unchanged in meaning for a single-valued variable, which is what
 * its existing tests pin; for a list it is the head. Selection among several doors is
 * `localFinishUrlsFor` plus the health/rotation logic in local-finish/handlers.ts, never this.
 */
export function localFinishUrlFor(moduleName: string, env: FinishBackendEnv): string | null {
  return localFinishUrlsFor(moduleName, env).urls[0] ?? null;
}

export function localFinishConfigured(moduleName: string, env: FinishBackendEnv): boolean {
  return localFinishUrlsFor(moduleName, env).urls.length > 0;
}
