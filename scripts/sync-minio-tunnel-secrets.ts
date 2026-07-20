#!/usr/bin/env tsx
// Upsert operator settings from .env into platform_secrets (DB wins over compose env at runtime).
// Run after .env changes (S3 public URLs, RunPod endpoints, local-gpu token, MinIO creds); then restart
// studio + module sidecars. Homelab: npm run sync:secrets:compose

import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlatformSecrets, upsertPlatformSecret } from "../src/platform-secrets-db.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

const TUNNEL_KEYS = [
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
] as const;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);
const existing = await listPlatformSecrets(db);

const updated: string[] = [];
const skipped: string[] = [];

for (const key of TUNNEL_KEYS) {
  const value = (process.env[key] ?? "").trim();
  if (!value) {
    skipped.push(`${key} (unset in env)`);
    continue;
  }
  const prior = existing.get(key);
  await upsertPlatformSecret(db, key, value);
  // #44: never interpolate `prior` -- TUNNEL_KEYS holds S3_SECRET_ACCESS_KEY / CF_AIG_TOKEN /
  // RUNPOD_API_KEY / LOCAL_BACKEND_TOKEN, and this runs right after a rotation, so `(was <old>)` would
  // print the just-rotated-away secret to stdout -> scrollback + `docker compose logs`. Log the fact of
  // change only.
  updated.push(prior && prior !== value ? `${key} (changed)` : key);
}

if (updated.length) {
  console.log("platform_secrets updated:", updated.join(", "));
  console.log("restart studio: docker compose restart studio");
} else {
  console.log("nothing to update;", skipped.join("; ") || "all tunnel keys unset in env");
}
