// GET /api/models on the LOCAL host -- mirror of vivijure-cf/tests/api-models-route.test.ts.
//
// The lead ruling is a canonical /api/models on BOTH hosts serving the full projected catalog.
// This route previously served the image rows ALONE here, so the two hosts disagreed about what
// /api/models means. The assertions below are the same ones the cf suite makes, so a divergence in
// either direction breaks a test rather than surfacing as a panel that works on one host only.
//
// Deliberately asserted against the ENVELOPE and the row KEYS, never a row count or a hardcoded id
// set: cf#129 phase 2 swaps the image rows to a module projection and must not touch this file.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { createPlanEnhanceTestFetcher } from "./plan-enhance-test-fetcher.js";
import type { Platform, ModuleTransport, FetcherLike } from "../src/platform/types.js";
import { IMAGE_MODELS } from "../src/image-models.js";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

class PlanEnhanceTransport implements ModuleTransport {
  constructor(private readonly fetcher: FetcherLike) {}
  resolve(binding: string): FetcherLike | null {
    return binding === "MODULE_PLANENHANCE" ? this.fetcher : null;
  }
  listBindings(): string[] {
    return ["MODULE_PLANENHANCE"];
  }
}

/** withModule=false installs NOTHING, which is the honest-empty case. */
function testPlatform(withModule: boolean): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-apimodels-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: withModule
      ? new PlanEnhanceTransport(createPlanEnhanceTestFetcher(join(dir, "renders"), { PLANNER_AI_MOCK: "true" }))
      : { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, PLANNER_AI_MOCK: "true" },
  };
}

async function getModels(withModule: boolean) {
  const app = createApp(testSettingsHost(testPlatform(withModule)));
  const res = await app.request("/api/models", { headers: { authorization: `Bearer ${SECRET}` } });
  return { app, res, body: (await res.json()) as { models: Array<Record<string, unknown>> } };
}

// Module discovery is cached for 60s by the route. Without this reset the FIRST no-module call in
// this file poisons every later module-installed call with an empty result -- which is exactly what
// happened on the first run here, and it reads as "the route does not project" rather than as test
// pollution. Reset before each test, like the cf suite does.
beforeEach(() => {
  _resetModuleDiscoveryCache();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/models (local host)", () => {
  it("serves the {models:[...]} envelope", async () => {
    const { res, body } = await getModels(false);
    expect(res.status).toBe(200);
    expect(Array.isArray(body.models)).toBe(true);
  });

  it("serves PROJECTED planning rows alongside the image rows", async () => {
    const { body } = await getModels(true);
    const types = new Set(body.models.map((m) => m.type));
    expect(types.has("chat")).toBe(true);
    expect(types.has("image")).toBe(true);
  });

  // The honest-fail pin, identical to cf's: nothing installed means NO planning rows. 200 with a
  // short list, never a 404, never a hardcoded backfill standing in for an uninstalled module.
  it("omits planning rows entirely when NO plan.enhance module is installed", async () => {
    const { res, body } = await getModels(false);
    expect(res.status).toBe(200);
    expect(body.models.filter((m) => m.type === "chat")).toEqual([]);
  });

  // Negative control for the assertion above: without it, "no chat rows" would also pass if the
  // route were broken and returned nothing at all. This proves real rows still come back.
  it("still serves the image rows in that same no-module case (empty-suite control)", async () => {
    const { body } = await getModels(false);
    const imageRows = body.models.filter((m) => m.type === "image");
    expect(imageRows.length).toBe(IMAGE_MODELS.length);
    expect(imageRows.length).toBeGreaterThan(0);
  });

  // The shared six-key row shape. Joan pinned the panel against the bytes cf emits; this asserts
  // local emits the same keys, so one generic render path serves both hosts.
  it("every row carries exactly the shared key set, whatever its origin", async () => {
    const { body } = await getModels(true);
    const allowed = ["capabilities", "group", "id", "label", "provider", "type"];
    const required = ["id", "label", "group", "type", "capabilities"];
    expect(body.models.length).toBeGreaterThan(0);
    for (const row of body.models) {
      expect(Object.keys(row).filter((k) => !allowed.includes(k))).toEqual([]);
      expect(Object.keys(row)).toEqual(expect.arrayContaining(required));
    }
  });

  // The agreement test: /api/storyboard/models is a FILTERED VIEW of this same projection, not a
  // second catalog. The planner picker rides that route on this host, so a drift between the two
  // would show up as the planner and the cast pickers disagreeing about what is installed.
  it("agrees with /api/storyboard/models on the planning rows", async () => {
    const app = createApp(testSettingsHost(testPlatform(true)));
    const headers = { authorization: `Bearer ${SECRET}` };
    const all = (await (await app.request("/api/models", { headers })).json()) as {
      models: Array<{ id: string; type: string }>;
    };
    const sb = (await (await app.request("/api/storyboard/models", { headers })).json()) as {
      models: Array<{ id: string }>;
    };
    const chatIds = all.models.filter((m) => m.type === "chat").map((m) => m.id).sort();
    expect(sb.models.map((m) => m.id).sort()).toEqual(chatIds);
    expect(chatIds.length).toBeGreaterThan(0);
  });
});
