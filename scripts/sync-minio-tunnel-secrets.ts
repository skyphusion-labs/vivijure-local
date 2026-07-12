#!/usr/bin/env tsx
// Upsert MinIO tunnel settings from .env into platform_secrets (DB wins over compose env at runtime).
// Run after enabling cloudflared MinIO ingress; then restart studio.

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
  updated.push(prior && prior !== value ? `${key} (was ${prior})` : key);
}

if (updated.length) {
  console.log("platform_secrets updated:", updated.join(", "));
  console.log("restart studio: docker compose restart studio");
} else {
  console.log("nothing to update;", skipped.join("; ") || "all tunnel keys unset in env");
}
