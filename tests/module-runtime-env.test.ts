import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import { upsertPlatformSecret } from "../src/platform-secrets-db.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";
import { runpodModuleEnvFromRuntime } from "../src/modules/runpod/env.js";

describe("loadModuleRuntimeEnv", () => {
  let dbPath = "";
  const prevDb = process.env.DATABASE_PATH;

  beforeEach(() => {
    const dir = join(tmpdir(), `vj-module-runtime-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "studio.db");
    process.env.DATABASE_PATH = dbPath;
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    writeFileSync(join(dir, ".keep"), "");
  });

  afterEach(() => {
    process.env.DATABASE_PATH = prevDb;
    if (dbPath) rmSync(join(dbPath, ".."), { recursive: true, force: true });
  });

  it("prefers platform_secrets over process env for RunPod keys", async () => {
    process.env.RUNPOD_API_KEY = "from-env";
    process.env.RUNPOD_ENDPOINT_ID = "env-endpoint";
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "RUNPOD_API_KEY", "from-db");
    await upsertPlatformSecret(db, "MUSETALK_RUNPOD_ENDPOINT_ID", "musetalk-ep");

    const runtime = await loadModuleRuntimeEnv();
    const env = runpodModuleEnvFromRuntime(runtime);
    expect(env.RUNPOD_API_KEY).toBe("from-db");
    expect(env.MUSETALK_RUNPOD_ENDPOINT_ID).toBe("musetalk-ep");
    expect(env.RUNPOD_ENDPOINT_ID).toBe("env-endpoint");
  });
});
