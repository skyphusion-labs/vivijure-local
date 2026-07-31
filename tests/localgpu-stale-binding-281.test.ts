// AN UPGRADED STUDIO MUST REACH THE SAME LANE-OFF STATE AS A FRESH ONE (local#281).
//
// local#280 rests on one sentence, stated in src/local-door-availability.ts and again in
// src/modules/local-gpu/app.ts: with the localgpu lane off there is no MODULE_LOCAL_GPU_URL, so
// moduleUrlsFromEnv builds no binding and core discovery never sees the module. That was true on a
// FRESH install and false on an UPGRADED one, and every test in the suite built fresh state, so
// nothing could express the difference.
//
// The chain that broke it: MODULE_LOCAL_GPU_URL was a "homelab compose default" (hardcoded in
// compose.yaml, upsert when set, NEVER PURGE when unset) and was seeded into platform_secrets on first
// boot. local#280 is the change that stopped hardcoding it, which is exactly what made never-purge
// wrong for that key. RuntimeEnv merges the DB OVER env with the DB winning, so `install:studio`
// writing MODULE_LOCAL_GPU_URL="" into .env cannot clear the row, and the studio binds MODULE_LOCAL_GPU
// to a container the `localgpu` profile guarantees does not exist.
//
// Every assertion here has a control that fails without the fix, because a fixture asserting an
// ABSENCE is the easiest kind to pass vacuously.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdirSync, rmSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverModules } from "@skyphusion-labs/vivijure-core";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import { listPlatformSecrets, upsertPlatformSecret } from "../src/platform-secrets-db.js";
import { bootstrapPlatformSecretsFromEnv } from "../src/platform-secrets-bootstrap.js";
import { PLATFORM_SECRET_DERIVED_KEYS } from "../src/platform-secrets-catalog.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";
import { createModuleTransport } from "../src/platform/modules.js";
import { discoverConfiguredModules } from "../src/module-registry.js";
import { localDoorHooksUnavailable, GPU_ENGINE_HOOKS } from "../src/local-door-availability.js";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const STALE_URL = "http://module-local-gpu:9102";

/** The migration that retires the key. Named, not guessed, so a renumber fails loudly here. */
const RETIRE_MIGRATION = "0015_retire_localgpu_module_url.sql";

let dir = "";
let dbPath = "";

beforeEach(() => {
  dir = join(tmpdir(), `vj-localgpu-281-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, "studio.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Build the DB a PRE-local#281 studio has: every migration EXCEPT the retirement one, then the row
 * first boot seeded from the compose default. Copying the real migrations directory minus one file
 * runs the real migration runner over real SQL -- the alternative (insert the row after a full
 * migrate) would silently test nothing, because 0015 would already be recorded as applied.
 */
function upgradedStudioDb(): void {
  const old = join(dir, "migrations-pre-0015");
  cpSync(MIGRATIONS, old, { recursive: true });
  const retired = join(old, RETIRE_MIGRATION);
  expect(readdirSync(old)).toContain(RETIRE_MIGRATION); // the file this fixture is about must exist
  unlinkSync(retired);
  migrateDatabase(dbPath, old);
}

describe("the stale platform_secrets row from a pre-local#280 studio", () => {
  it("CONTROL: is what a pre-upgrade studio actually has, and it does build a binding", async () => {
    // The negative control for every assertion below. Without it, "no binding" could be passing
    // because the fixture never produced one in the first place.
    upgradedStudioDb();
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "MODULE_LOCAL_GPU_URL", STALE_URL);

    const runtime = await RuntimeEnv.load({ MODULE_LOCAL_GPU_URL: "" }, db);
    expect(runtime.get("MODULE_LOCAL_GPU_URL")).toBe(STALE_URL); // DB beats the empty .env value
    expect(createModuleTransport(runtime.asProcessEnv()).listBindings()).toContain("MODULE_LOCAL_GPU");
  });

  it("is deleted by the upgrade itself, so a lane-off studio binds nothing", async () => {
    upgradedStudioDb();
    const seed = openDatabase(dbPath);
    await upsertPlatformSecret(seed, "MODULE_LOCAL_GPU_URL", STALE_URL);
    await upsertPlatformSecret(seed, "MODULE_PLANENHANCE_URL", "http://module-plan-enhance:9140");

    migrateDatabase(dbPath, MIGRATIONS); // the upgrade: 0015 applies

    const db = openDatabase(dbPath);
    const stored = await listPlatformSecrets(db);
    expect(stored.has("MODULE_LOCAL_GPU_URL")).toBe(false);
    expect(stored.get("MODULE_PLANENHANCE_URL")).toBe("http://module-plan-enhance:9140"); // scoped

    const runtime = await RuntimeEnv.load({ MODULE_LOCAL_GPU_URL: "" }, db);
    expect(createModuleTransport(runtime.asProcessEnv()).listBindings()).not.toContain(
      "MODULE_LOCAL_GPU",
    );
  });

  it("does not come back: boot never re-seeds a derived key", async () => {
    // The row is derived from LOCAL_BACKEND_URL, so seeding a copy is what created the problem. Env
    // stays the only authority; compose passes the value directly when the lane is on.
    expect(PLATFORM_SECRET_DERIVED_KEYS).toContain("MODULE_LOCAL_GPU_URL");
    migrateDatabase(dbPath, MIGRATIONS);
    const db = openDatabase(dbPath);

    const { seeded } = await bootstrapPlatformSecretsFromEnv(db, {
      MODULE_LOCAL_GPU_URL: STALE_URL,
      MODULE_PLANENHANCE_URL: "http://module-plan-enhance:9140",
    });

    expect(seeded).not.toContain("MODULE_LOCAL_GPU_URL");
    expect(seeded).toContain("MODULE_PLANENHANCE_URL"); // CONTROL: bootstrap still seeds normal keys
    expect((await listPlatformSecrets(db)).has("MODULE_LOCAL_GPU_URL")).toBe(false);
  });

  it("does not break the lane ON: env alone still binds the module", async () => {
    migrateDatabase(dbPath, MIGRATIONS);
    const db = openDatabase(dbPath);
    await bootstrapPlatformSecretsFromEnv(db, { MODULE_LOCAL_GPU_URL: STALE_URL });

    const runtime = await RuntimeEnv.load({ MODULE_LOCAL_GPU_URL: STALE_URL }, db);
    expect(runtime.source("MODULE_LOCAL_GPU_URL")).toBe("env"); // not "database": no stored copy
    expect(createModuleTransport(runtime.asProcessEnv()).listBindings()).toContain("MODULE_LOCAL_GPU");
  });
});

describe("the failure shape a stale binding produces", () => {
  // Established rather than assumed, because it decides whether the row above is a defect or a wart:
  // core discovery DROPS an unreachable binding (three manifest attempts, then null), it does not keep
  // it. So the panel stays correct and this is NOT the local#201 broken-button class -- the cost is a
  // connection failure absorbed on every discovery pass, plus a warning naming a module nobody
  // installed. Real, worth fixing, not a wrong-render bug.
  //
  // 127.0.0.1:1 is a real closed port: the refusal comes from the OS, not from a stub of my own
  // assumption about what an absent container does.
  const DEAD = "http://127.0.0.1:1";

  function envWith(urls: Record<string, string>): Record<string, unknown> {
    const transport = createModuleTransport(urls as NodeJS.ProcessEnv);
    const env: Record<string, unknown> = {};
    for (const binding of transport.listBindings()) env[binding] = transport.resolve(binding);
    return env;
  }

  it("drops the unreachable module instead of advertising it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = envWith({ MODULE_LOCAL_GPU_URL: DEAD });
    expect(Object.keys(env)).toEqual(["MODULE_LOCAL_GPU"]); // CONTROL: the binding really was built

    const modules = await discoverModules(env);

    expect(modules).toEqual([]);
    expect(warn).toHaveBeenCalled(); // absorbed, but never silently
  }, 20_000);

  it("leaves the panel honest: both GPU hooks report unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const modules = await discoverConfiguredModules(envWith({ MODULE_LOCAL_GPU_URL: DEAD }));

    const unavailable = localDoorHooksUnavailable(modules);
    expect(Object.keys(unavailable).sort()).toEqual([...GPU_ENGINE_HOOKS].sort());
  }, 20_000);
});
