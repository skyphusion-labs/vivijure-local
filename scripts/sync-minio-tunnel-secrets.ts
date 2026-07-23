#!/usr/bin/env tsx
// Upsert operator settings from .env into platform_secrets (DB wins over compose env at runtime).
// Run after .env changes (S3 public URLs, RunPod endpoints, local-gpu token, MinIO creds); then restart
// studio + module sidecars. Homelab: npm run sync:secrets:compose

import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlatformSecrets } from "../src/platform-secrets-db.js";
import { syncPlatformSecretsFromEnv } from "../src/platform-secrets-sync.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);
const existing = await listPlatformSecrets(db);

const { updated, cleared, skipped } = await syncPlatformSecretsFromEnv(db, process.env, existing);

if (updated.length) {
  console.log("platform_secrets updated:", updated.join(", "));
}
if (cleared.length) {
  console.log("platform_secrets cleared (unset in env):", cleared.join(", "));
}
if (updated.length || cleared.length) {
  console.log(
    "force-recreate consumers (DB wins over compose env): docker compose up -d --force-recreate studio module-local-gpu",
  );
} else {
  console.log("nothing to update;", skipped.join("; ") || "all sync keys unset in env");
}
