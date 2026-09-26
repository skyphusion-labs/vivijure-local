#!/usr/bin/env tsx
// Upsert operator settings from .env into platform_secrets (DB wins over compose env at runtime).
// Run after .env changes (S3 public URLs, RunPod endpoints, local-gpu token, MinIO creds); then restart
// studio + module sidecars. Homelab: npm run sync:secrets:compose

import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlatformSecrets } from "../src/platform-secrets-db.js";
import { divergentRows, formatSeedStoreDrift, seedStoreDrift } from "../src/platform-secrets-drift.js";
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

// local#379: report the seed/store divergence that SURVIVES this sync, on EVERY run.
//
// The `skipped` list above only printed in the branch where nothing at all was updated, so a stale key
// whose .env value the sync refuses to propagate was invisible the moment any OTHER key changed in the
// same run. That is the reporting half of the same defect: the operator edited the documented file, the
// command printed a success line, and the key it could not touch was never named.
//
// Names only, never values. This reports; it does not reconcile.
const postSync = seedStoreDrift(process.env, await listPlatformSecrets(db));
for (const line of formatSeedStoreDrift(postSync)) console.log(line);
if (divergentRows(postSync).length > 0) {
  console.log("`npm run check:secret-drift` exits non-zero while the above remains.");
}
