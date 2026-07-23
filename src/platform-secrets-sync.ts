import {
  PLATFORM_MODULE_URL_COMPOSE_DEFAULTS,
  PLATFORM_MODULE_URL_PURGEABLE_KEYS,
  PLATFORM_SECRET_FIELDS,
} from "./platform-secrets-catalog.js";
import { deletePlatformSecret, upsertPlatformSecret } from "./platform-secrets-db.js";
import type { Database } from "./platform/types.js";

/** Operator settings synced from .env by npm run sync:secrets (non-module keys skip when unset). */
export const PLATFORM_TUNNEL_SYNC_KEYS = [
  "PUBLIC_BASE_URL",
  "S3_PRESIGN_ENDPOINT",
  "S3_FETCH_ALLOW_HOSTS",
  "S3_ALLOW_HTTP_FETCH",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "GATEWAY_ID",
  "CF_AIG_TOKEN",
  "PLANNER_AI_MOCK",
  "LOCAL_BACKEND_URL",
  "LOCAL_BACKEND_TOKEN",
  "DEMO_RENDER_ENABLED",
  "AUTH_MODE",
  "RUNPOD_API_KEY",
  "RUNPOD_ENDPOINT_ID",
  "BACKEND_RUNPOD_ENDPOINT_ID",
  "KEYFRAME_RUNPOD_ENDPOINT_ID",
  "VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID",
  "MUSETALK_RUNPOD_ENDPOINT_ID",
  "AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID",
  "RUNPOD_WAN_TRAIN_ENDPOINT_ID",
  "FINISH_BACKEND",
  "FINISH_LIPSYNC_BACKEND",
  "FINISH_UPSCALE_BACKEND",
  "LOCAL_FINISH_LIPSYNC_URL",
  "LOCAL_FINISH_UPSCALE_URL",
  "LOCAL_FINISH_TOKEN",
] as const satisfies readonly (typeof PLATFORM_SECRET_FIELDS)[number]["key"][];

export interface SyncPlatformSecretsResult {
  updated: string[];
  cleared: string[];
  skipped: string[];
}

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? "").trim();
}

/** Upsert tunnel keys when set; upsert or purge module URL keys (DB wins at runtime). */
export async function syncPlatformSecretsFromEnv(
  db: Database,
  env: NodeJS.ProcessEnv,
  existing: Map<string, string>,
): Promise<SyncPlatformSecretsResult> {
  const updated: string[] = [];
  const cleared: string[] = [];
  const skipped: string[] = [];

  for (const key of PLATFORM_TUNNEL_SYNC_KEYS) {
    const value = envValue(env, key);
    if (!value) {
      skipped.push(`${key} (unset in env)`);
      continue;
    }
    const prior = existing.get(key);
    await upsertPlatformSecret(db, key, value);
    updated.push(prior && prior !== value ? `${key} (changed)` : key);
  }

  for (const key of PLATFORM_MODULE_URL_COMPOSE_DEFAULTS) {
    const value = envValue(env, key);
    if (!value) {
      skipped.push(`${key} (unset in env; compose default not overwritten)`);
      continue;
    }
    const prior = existing.get(key);
    await upsertPlatformSecret(db, key, value);
    updated.push(prior && prior !== value ? `${key} (changed)` : key);
  }

  for (const key of PLATFORM_MODULE_URL_PURGEABLE_KEYS) {
    const value = envValue(env, key);
    if (value) {
      const prior = existing.get(key);
      await upsertPlatformSecret(db, key, value);
      updated.push(prior && prior !== value ? `${key} (changed)` : key);
      continue;
    }
    if (existing.has(key)) {
      await deletePlatformSecret(db, key);
      cleared.push(key);
      continue;
    }
    skipped.push(`${key} (unset in env)`);
  }

  return { updated, cleared, skipped };
}
