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
    // MODULE_LOCAL_GPU_URL used to be the first example here. It is NOT a compose default any more
    // (local#280 stopped hardcoding it, local#281 reclassified it) -- see the purge test below.
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_BEAT_SYNC_URL", "http://module-beat-sync:9130");
    await upsertPlatformSecret(db, "MODULE_PLANENHANCE_URL", "http://module-plan-enhance:9140");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).not.toContain("MODULE_BEAT_SYNC_URL");
    expect(result.cleared).not.toContain("MODULE_PLANENHANCE_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("MODULE_BEAT_SYNC_URL")).toBe("http://module-beat-sync:9130");
    expect(after.get("MODULE_PLANENHANCE_URL")).toBe("http://module-plan-enhance:9140");
  });

  it("purges the derived MODULE_LOCAL_GPU_URL when unset in env (local#281)", async () => {
    // The lane is derived from LOCAL_BACKEND_URL now, so a stored copy that outlives the lane is a
    // binding to a container the `localgpu` profile guarantees is not running.
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_LOCAL_GPU_URL", "http://module-local-gpu:9102");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).toContain("MODULE_LOCAL_GPU_URL");
    const after = await listPlatformSecrets(db);
    expect(after.has("MODULE_LOCAL_GPU_URL")).toBe(false);
  });

  it("purges RunPod MODULE_KEYFRAME_URL when unset (cloud opt-in only)", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_KEYFRAME_URL", "http://module-keyframe:9101");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).toContain("MODULE_KEYFRAME_URL");
    const after = await listPlatformSecrets(db);
    expect(after.has("MODULE_KEYFRAME_URL")).toBe(false);
  });

  it("upserts compose-default MODULE URLs when set in env", async () => {
    const db = openDatabase(dbPath);
    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {
      MODULE_BEAT_SYNC_URL: "http://module-beat-sync:9130",
    }, existing);

    expect(result.updated).toContain("MODULE_BEAT_SYNC_URL");
    const after = await listPlatformSecrets(db);
    expect(after.get("MODULE_BEAT_SYNC_URL")).toBe("http://module-beat-sync:9130");
  });

  it("never stores a derived MODULE URL, even when it IS set in env (local#281)", async () => {
    // The value is live in compose whenever the lane is on, so a stored copy adds nothing and
    // survives the lane being turned off. Env is the only authority.
    const db = openDatabase(dbPath);
    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {
      MODULE_LOCAL_GPU_URL: "http://module-local-gpu:9102",
    }, existing);

    expect(result.updated).not.toContain("MODULE_LOCAL_GPU_URL");
    expect((await listPlatformSecrets(db)).has("MODULE_LOCAL_GPU_URL")).toBe(false);
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

  it("purges retired RUNPOD_WAN_TRAIN_ENDPOINT_ID when unset in env", async () => {
    const db = openDatabase(dbPath);
    // Opaque placeholder on purpose: the real local train endpoint (cf#215 gate 2) is DELETED, and a
    // tracked concrete endpoint id outlives the resource it names. The test only needs a value to
    // store and then assert purged.
    await upsertPlatformSecret(db, "RUNPOD_WAN_TRAIN_ENDPOINT_ID", "ep-retired-placeholder");

    const existing = await listPlatformSecrets(db);
    const result = await syncPlatformSecretsFromEnv(db, {}, existing);

    expect(result.cleared).toContain("RUNPOD_WAN_TRAIN_ENDPOINT_ID");
    const after = await listPlatformSecrets(db);
    expect(after.has("RUNPOD_WAN_TRAIN_ENDPOINT_ID")).toBe(false);
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
