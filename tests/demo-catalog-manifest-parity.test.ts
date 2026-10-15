// The demo catalog may not project a module that no longer exists (local#400).
//
// THE DEFECT CLASS, not the instance. `text-overlay` was retired by local#39: the module went, its
// dev/manifests entry went, the POST /overlay handler became a 410 (local#364) -- and the demo
// catalog seed row outlived all three. GET /api/modules kept returning it with a full four-field
// config_schema, so public/planner-render-config.js, which is a faithful PROJECTION of that
// response, kept rendering a working-looking Text overlay panel for a dead door. Nothing looked
// degraded and nothing looked absent: it looked available, and only failed after a user filled it
// in and submitted.
//
// Deleting the row fixes the instance. This file is what makes the class detectable, because the
// repo already knew the answer and nobody was asking: `dev/manifests/` IS the in-repo record of
// which modules exist (synced from the module workers by scripts/sync-module-manifests.ts, held
// honest by scripts/check-module-manifest-drift.sh), and a retirement deletes the manifest. So a
// seeded module with no manifest is exactly a row that outlived its module.
//
// CHECKED AT THE PROJECTION, NOT AT THE MODULE LIST, which is the acceptance criterion local#400
// wrote for itself. "The module is retired" and "the panel is gone" are different facts, and the
// first was already true for months while the second was false. So this asserts on the body of a
// real GET /api/modules through the real app with the real demo migrations applied, not on the SQL
// text and not on a directory listing.
//
// WHAT IT CANNOT SEE: whether the module a manifest describes actually RUNS. A manifest present and
// a worker reachable are different facts too; hook availability is GET /api/modules
// `hooks_unavailable` and tests/hook-availability-parity.test.ts, a separate channel on purpose.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "c".repeat(64);
const repoRoot = join(import.meta.dirname, "..");
const demoDir = join(repoRoot, "migrations", "demo");
const manifestDir = join(repoRoot, "dev", "manifests");

const dirs: string[] = [];

/** Every module this repo still carries a manifest for. The authority; see the header. */
function manifestNames(): Set<string> {
  return new Set(
    readdirSync(manifestDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
  );
}

function applyDemoMigrations(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  for (const file of readdirSync(demoDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()) {
    db.exec(readFileSync(join(demoDir, file), "utf8"));
  }
  db.close();
}

/** A demo studio exactly as the public demo deploy builds it: base schema, then migrations/demo. */
function demoPlatform(mutate?: (dbPath: string) => void): Platform {
  const dir = mkdtempSync(join(tmpdir(), "joan-400-demo-parity-"));
  dirs.push(dir);
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(repoRoot, "migrations"));
  applyDemoMigrations(dbPath);
  if (mutate) mutate(dbPath);
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "demo", PUBLIC_BASE_URL: "http://127.0.0.1:8790", PLANNER_AI_MOCK: "true" },
  };
}

/** The projection itself: what the panel would render from. */
async function catalogModuleNames(platform: Platform): Promise<string[]> {
  const res = await createApp(testSettingsHost(platform)).request("/api/modules");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { modules?: { name?: string }[] };
  expect(Array.isArray(body.modules)).toBe(true);
  return body.modules!.map((m) => String(m.name));
}

/** Seeded module names with no in-repo manifest: rows that outlived their module. */
function ghosts(catalog: string[], manifests: Set<string>): string[] {
  return catalog.filter((name) => !manifests.has(name));
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("demo catalog / manifest parity", () => {
  it("control: neither side of the comparison is empty, so a pass is not vacuous", async () => {
    const manifests = manifestNames();
    const catalog = await catalogModuleNames(demoPlatform());
    // If either of these were zero, ghosts() would return [] for the wrong reason and this suite
    // would report health while measuring nothing. This is the denominator.
    expect(manifests.size).toBeGreaterThan(20);
    expect(catalog.length).toBeGreaterThan(20);
    // And the two populations really do overlap, rather than being two unrelated name spaces.
    expect(catalog).toContain("keyframe");
    expect(manifests.has("keyframe")).toBe(true);
  });

  it("control: a row whose module is gone IS detected", async () => {
    // The positive control, and the reason this file is a guard rather than decoration. It injects
    // the exact shape local#400 found -- a structurally valid manifest for a module with no
    // dev/manifests entry -- and requires the check to fail on it. Without this, a future change
    // that quietly stopped surfacing dispatch modules would turn the assertion below permanently
    // green while the demo studio went on projecting whatever it liked.
    const ghostManifest = JSON.stringify({
      name: "joan-400-ghost-module",
      version: "0.0.1",
      api: "vivijure-module/2",
      hooks: ["finish"],
      provides: [{ id: "joan-400-ghost-module", label: "Ghost (positive control)" }],
      config_schema: { knob: { type: "bool", default: false, label: "a control that should not exist" } },
      ui: { section: "finish", order: 999 },
    });
    const platform = demoPlatform((dbPath) => {
      const db = new DatabaseSync(dbPath);
      db.prepare(
        "INSERT INTO installed_modules (name, script_name, manifest_json, api, installed_at, enabled)" +
          " VALUES (?, ?, ?, ?, ?, 1)",
      ).run("joan-400-ghost-module", "demo-seed-joan-400-ghost-module", ghostManifest, "vivijure-module/2", 1752000000);
      db.close();
    });

    const catalog = await catalogModuleNames(platform);
    // The ghost really did reach the projection, so the detector is being fed the failing case.
    expect(catalog).toContain("joan-400-ghost-module");
    expect(manifestNames().has("joan-400-ghost-module")).toBe(false);
    expect(ghosts(catalog, manifestNames())).toContain("joan-400-ghost-module");
  });

  it("every module the demo catalog projects still has an in-repo manifest", async () => {
    const manifests = manifestNames();
    const catalog = await catalogModuleNames(demoPlatform());
    const found = ghosts(catalog, manifests);
    // The message carries the denominator, so a failure says how much was checked, not only what
    // broke. This is the assertion that was red before local#400 removed the text-overlay row.
    expect(
      found,
      `${catalog.length} modules projected by GET /api/modules, ${manifests.size} manifests in ` +
        `dev/manifests/; these are seeded with no manifest, so their module is gone: ` +
        `${found.join(", ") || "(none)"}`,
    ).toEqual([]);
  });

  it("the retired text-overlay door specifically is gone from the projection", async () => {
    // The instance, kept as a named regression alongside the class. POST /overlay answers 410
    // (local#364), so a panel for it is a control whose only outcome is a failed submit.
    const catalog = await catalogModuleNames(demoPlatform());
    expect(catalog).not.toContain("text-overlay");
    const res = await createApp(testSettingsHost(demoPlatform())).request("/api/modules");
    const body = (await res.json()) as { hooks?: Record<string, string[]> };
    expect(body.hooks?.finish ?? []).not.toContain("text-overlay");
  });

  it("the seed file itself does not re-add it on a fresh apply", () => {
    // Belt to the projection's braces: a fresh demo DB is built from this file, so if the row came
    // back here every assertion above would go red -- but naming it makes the failure legible.
    const sql = readFileSync(join(demoDir, "0001_demo_seed.sql"), "utf8");
    expect(sql).not.toMatch(/^\s*\('text-overlay'/m);
  });
});
