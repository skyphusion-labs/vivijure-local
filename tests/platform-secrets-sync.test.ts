import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import { listPlatformSecrets, upsertPlatformSecret } from "../src/platform-secrets-db.js";
import { syncPlatformSecretsFromEnv } from "../src/platform-secrets-sync.js";

describe("syncPlatformSecretsFromEnv", () => {
  let dbPath = "";

  beforeEach(() => {
    const dir = join(tmpdir(), `vj-secrets-sync-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  });

  afterEach(() => {
    if (dbPath) rmSync(join(dbPath, ".."), { recursive: true, force: true });
  });

  it("purges stale optional MODULE_* URLs when unset in env", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_LIPSYNC_URL", "http://module-finish-lipsync:9110");
    await upsertPlatformSecret(db, "MODULE_FINISH_RIFE_URL", "http://module-finish-rife:9111");
    await upsertPlatformSecret(db, "LOCAL_FINISH_RIFE_URL", "http://finish-rife:8010");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).toEqual(
      expect.arrayContaining([
        "MODULE_LIPSYNC_URL",
        "MODULE_FINISH_RIFE_URL",
        "LOCAL_FINISH_RIFE_URL",
      ]),
    );
    const after = await listPlatformSecrets(db);
    expect(after.has("MODULE_LIPSYNC_URL")).toBe(false);
    expect(after.has("MODULE_FINISH_RIFE_URL")).toBe(false);
    expect(after.has("LOCAL_FINISH_RIFE_URL")).toBe(false);
  });

  it("never purges homelab compose-default MODULE URLs when unset in env", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_KEYFRAME_URL", "http://module-keyframe:9101");
    await upsertPlatformSecret(db, "MODULE_LOCAL_GPU_URL", "http://module-local-gpu:9102");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).not.toContain("MODULE_KEYFRAME_URL");
    expect(result.cleared).not.toContain("MODULE_LOCAL_GPU_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("MODULE_KEYFRAME_URL")).toBe("http://module-keyframe:9101");
    expect(after.get("MODULE_LOCAL_GPU_URL")).toBe("http://module-local-gpu:9102");
  });

  it("upserts compose-default MODULE URLs when set in env", async () => {
    const db = openDatabase(dbPath);
    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {
      MODULE_LOCAL_GPU_URL: "http://module-local-gpu:9102",
    }, existing);

    expect(result.updated).toContain("MODULE_LOCAL_GPU_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("MODULE_LOCAL_GPU_URL")).toBe("http://module-local-gpu:9102");
  });

  it("upserts optional MODULE_* URLs when set in env", async () => {
    const db = openDatabase(dbPath);
    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {
      MODULE_UPSCALE_URL: "http://module-finish-upscale:9112",
    }, existing);

    expect(result.updated).toContain("MODULE_UPSCALE_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("MODULE_UPSCALE_URL")).toBe("http://module-finish-upscale:9112");
  });

  it("skips unset tunnel keys without deleting them", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "PUBLIC_BASE_URL", "https://example.test");
    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).not.toContain("PUBLIC_BASE_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("PUBLIC_BASE_URL")).toBe("https://example.test");
  });
});
