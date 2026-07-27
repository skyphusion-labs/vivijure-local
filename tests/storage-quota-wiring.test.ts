import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { applyRuntimeEnvToPlatform } from "../src/platform/reload.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";
import type { Platform } from "../src/platform/types.js";
import {
  STORAGE_USAGE_DDL,
  isMeteredStore,
  meteredObjectStore,
  storageUsedBytes,
} from "@skyphusion-labs/vivijure-core/storage-quota";

// core#52 WIRING tests, vivijure-cf twin. These run against the REAL migration, the REAL SQLite
// database, the REAL filesystem store and the REAL Hono app: a stub could not tell us whether the
// migration is valid SQLite, whether the gate is registered on the routes we think, or whether the
// metering seam survives a settings reload.

const SECRET = "a".repeat(32) + "b".repeat(32);

function auth() {
  return { authorization: `Bearer ${SECRET}` };
}

function makePlatform(root: string, quota?: string): Platform & { rawStore: FilesystemObjectStore } {
  const dbPath = join(root, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  // The artifact root is a SUBDIRECTORY: a reconcile lists everything in the store, and a store rooted
  // at the same directory as studio.db would (correctly) account the database file itself.
  const rawStore = new FilesystemObjectStore(join(root, "artifacts"));
  const db = openDatabase(dbPath);
  return {
    rawStore,
    db,
    renders: meteredObjectStore(rawStore, db),
    chatBucket: rawStore,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: {
      AUTH_MODE: "token",
      STUDIO_API_TOKEN: SECRET,
      ...(quota ? { R2_STORAGE_QUOTA_BYTES: quota } : {}),
    },
  } as Platform & { rawStore: FilesystemObjectStore };
}

describe("migration 0014 carries core's schema verbatim", () => {
  it("matches STORAGE_USAGE_DDL", () => {
    const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "0014_storage_usage.sql"), "utf8");
    const statement = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;$/, "")
      .trim();
    expect(statement).toBe(STORAGE_USAGE_DDL);
  });
});

describe("storage accounting end to end (real DB, real store, real app)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-quota-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("meters real writes and real deletes through the platform store", async () => {
    const platform = makePlatform(dir);
    // Negative control: the store the platform wraps is NOT metered on its own.
    expect(isMeteredStore(platform.rawStore)).toBe(false);
    expect(isMeteredStore(platform.renders)).toBe(true);

    await platform.renders.put("renders/a.mp4", new Uint8Array(4096));
    await platform.renders.put("renders/b.mp4", new Uint8Array(1024));
    expect(await storageUsedBytes(platform.db)).toBe(5120);

    // A rewrite of the SAME key updates its row (the job-doc case) rather than adding to the total.
    await platform.renders.put("renders/a.mp4", new Uint8Array(2048));
    expect(await storageUsedBytes(platform.db)).toBe(3072);

    await platform.renders.delete("renders/a.mp4");
    expect(await storageUsedBytes(platform.db)).toBe(1024);
  });

  it("DENIES a submit route over the ceiling, with the real numbers, and leaves reads working", async () => {
    const platform = makePlatform(dir, "4000");
    const app = createApp(testSettingsHost(platform));
    await platform.renders.put("renders/big.mp4", new Uint8Array(5000));

    const denied = await app.request("/api/render/film", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ film_id: "x" }),
    });
    expect(denied.status).toBe(507);
    const body = (await denied.json()) as { error: string };
    expect(body.error).toContain("5000 bytes stored");
    expect(body.error).toContain("4000-byte R2_STORAGE_QUOTA_BYTES");

    // Reads keep working while full: the operator has to be able to look at what they have.
    const usage = await app.request("/api/storage/usage", { headers: auth() });
    expect(usage.status).toBe(200);
    expect(await usage.json()).toMatchObject({ used_bytes: 5000, quota_bytes: 4000, over: true, objects: 1 });
  });

  it("does NOT deny when the studio is under its ceiling (the positive control)", async () => {
    const platform = makePlatform(dir, "1000000");
    const app = createApp(testSettingsHost(platform));
    await platform.renders.put("renders/small.mp4", new Uint8Array(10));
    const res = await app.request("/api/render/film", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ film_id: "x" }),
    });
    // The submit fails for its own reasons (no RunPod in a unit test); what matters is that the STORAGE
    // gate let it through. Without this control the deny above could be passing for the wrong reason.
    expect(res.status).not.toBe(507);
  });

  it("knob UNSET means the gate is a no-op", async () => {
    const platform = makePlatform(dir);
    const app = createApp(testSettingsHost(platform));
    await platform.renders.put("renders/huge.mp4", new Uint8Array(50_000));
    const res = await app.request("/api/render/film", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ film_id: "x" }),
    });
    expect(res.status).not.toBe(507);
    const usage = await app.request("/api/storage/usage", { headers: auth() });
    expect(await usage.json()).toMatchObject({ quota_bytes: null, over: false });
  });

  it("reconcile rebuilds the ledger from the store, in the SAME key spelling the write path uses", async () => {
    const platform = makePlatform(dir);
    const app = createApp(testSettingsHost(platform));
    // Written straight to the RAW store: an artifact that predates accounting (the backfill case).
    await platform.rawStore.put("renders/legacy.mp4", new Uint8Array(3000));
    // And a ledger row for an object that no longer exists (the lifecycle-expiry / out-of-band drift).
    await platform.renders.put("renders/gone.mp4", new Uint8Array(999));
    await platform.rawStore.delete("renders/gone.mp4");
    expect(await storageUsedBytes(platform.db)).toBe(999);

    const res = await app.request("/api/storage/reconcile", { method: "POST", headers: auth() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ objects: 1, bytes: 3000, unsized: 0 });
    expect(await storageUsedBytes(platform.db)).toBe(3000);

    // The spelling matters: a reconciled row must be the key a later delete will present, or the counter
    // drifts high forever. Deleting through the metered store has to bring the total back to zero.
    await platform.renders.delete("renders/legacy.mp4");
    expect(await storageUsedBytes(platform.db)).toBe(0);
  });

  it("a settings RELOAD keeps the store metered (the seam that rebuilds storage)", async () => {
    const platform = makePlatform(dir);
    const runtime = RuntimeEnv.forTests({ ARTIFACT_ROOT: join(dir, "artifacts"), R2_STORAGE_QUOTA_BYTES: "9999" });
    applyRuntimeEnvToPlatform(platform, runtime, { publicBase: "http://127.0.0.1:8790" });
    // applyRuntimeEnvToPlatform REPLACES platform.renders with a freshly built store. If the seam were
    // only at boot, accounting would silently stop the first time an operator saved settings.
    expect(isMeteredStore(platform.renders)).toBe(true);
    expect(platform.vars.R2_STORAGE_QUOTA_BYTES).toBe("9999");
    await platform.renders.put("renders/after-reload.mp4", new Uint8Array(256));
    expect(await storageUsedBytes(platform.db)).toBe(256);
  });
});
