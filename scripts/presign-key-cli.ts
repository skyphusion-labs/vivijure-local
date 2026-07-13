#!/usr/bin/env tsx
/** Print a presigned GET URL for an object key (studio platform secrets + MinIO tunnel). */
import "dotenv/config";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { presignR2Get } from "@skyphusion-labs/vivijure-core/presign";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import type { Platform } from "../src/platform/types.js";
import {
  createModuleTransport,
  createStorage,
  migrateDatabase,
  openDatabase,
  RuntimeSecretStore,
} from "../src/platform/index.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";
import { applyRuntimeEnvToPlatform } from "../src/platform/reload.js";
import { bootstrapPlatformSecretsFromEnv } from "../src/platform-secrets-bootstrap.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const key = process.argv[2]?.trim();
if (!key) {
  console.error("usage: presign-key-cli.ts <object-key>");
  process.exit(2);
}

const dbPath = process.env.DATABASE_PATH || join(repoRoot, "data", "studio.db");
migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);
await bootstrapPlatformSecretsFromEnv(db, process.env);
const runtime = await RuntimeEnv.load(process.env, db);
const publicBase = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8790";
const storage = createStorage(runtime.asProcessEnv(), {
  publicBase,
  token: runtime.get("STUDIO_API_TOKEN"),
});
const platform: Platform = {
  db,
  renders: storage.renders,
  chatBucket: storage.chatBucket,
  presigner: storage.presigner,
  secrets: new RuntimeSecretStore(runtime),
  modules: createModuleTransport(runtime.asProcessEnv()),
  vars: {},
};
applyRuntimeEnvToPlatform(platform, runtime, { publicBase });
const url = await presignR2Get(orchestratorContextFromPlatform(platform), key, 3600);
process.stdout.write(url);
