// GET /api/models on the LOCAL host -- mirror of vivijure-cf/tests/api-models-route.test.ts.
//
// The lead ruling is a canonical /api/models on BOTH hosts serving the full projected catalog.
// This route previously served the image rows ALONE here, so the two hosts disagreed about what
// /api/models means. The assertions below are the same ones the cf suite makes, so a divergence in
// either direction breaks a test rather than surfacing as a panel that works on one host only.
//
// Deliberately asserted against the ENVELOPE and the row KEYS, never a row count or a hardcoded id
// set: cf#129 phase 2 swaps the image rows to a module projection and must not touch this file.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { createPlanEnhanceTestFetcher } from "./plan-enhance-test-fetcher.js";
import { createFakeImageModule, FAKE_IMAGE_MODELS } from "./fake-image-module.js";
import type { Platform, ModuleTransport, FetcherLike } from "../src/platform/types.js";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

class BothModulesTransport implements ModuleTransport {
  constructor(
    private readonly planner: FetcherLike,
    private readonly image: FetcherLike,
  ) {}
  resolve(binding: string): FetcherLike | null {
    if (binding === "MODULE_PLANENHANCE") return this.planner;
    if (binding === "MODULE_ACMEIMAGEGEN") return this.image;
    return null;
  }
  listBindings(): string[] {
    return ["MODULE_PLANENHANCE", "MODULE_ACMEIMAGEGEN"];
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
      ? new BothModulesTransport(
          createPlanEnhanceTestFetcher(join(dir, "renders"), { PLANNER_AI_MOCK: "true" }),
          createFakeImageModule(),
        )
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

  it("serves PROJECTED planning rows alongside PROJECTED image rows", async () => {
    const { body } = await getModels(true);
    const types = new Set(body.models.map((m) => m.type));
    expect(types.has("chat")).toBe(true);
    expect(types.has("image")).toBe(true);
    // The image ids come from the MODULE manifest, not from any list in this repo. That is the
    // whole point of phase 2: grep the studio for these ids and you will not find them.
    const ids = body.models.map((m) => m.id);
    for (const m of FAKE_IMAGE_MODELS) expect(ids).toContain(m);
  });

  // The empty-suite control, relocated: with modules installed, real rows of BOTH kinds come back.
  // Without this, the honest-empty assertions below would also pass on a totally broken route.
  it("control: both projections yield real rows when modules ARE installed", async () => {
    const { body } = await getModels(true);
    expect(body.models.filter((m) => m.type === "chat").length).toBeGreaterThan(0);
    expect(body.models.filter((m) => m.type === "image").length).toBe(FAKE_IMAGE_MODELS.length);
  });

  // The honest-fail pin, identical to cf's: nothing installed means NO planning rows. 200 with a
  // short list, never a 404, never a hardcoded backfill standing in for an uninstalled module.
  it("omits planning rows entirely when NO plan.enhance module is installed", async () => {
    const { res, body } = await getModels(false);
    expect(res.status).toBe(200);
    expect(body.models.filter((m) => m.type === "chat")).toEqual([]);
  });

  it("omits IMAGE rows entirely when no image.generate module is installed", async () => {
    const { res, body } = await getModels(false);
    expect(res.status).toBe(200);
    expect(body.models.filter((m) => m.type === "image")).toEqual([]);
  });

  // Negative control for the assertion above: without it, "no chat rows" would also pass if the
  // route were broken and returned nothing at all. This proves real rows still come back.
  // cf#129 phase 2 changed what "nothing installed" means: the image rows are a PROJECTION now, so
  // with no modules at all BOTH halves are legitimately empty. The empty-suite control moves to the
  // module-installed case below, where real rows must come back.
  it("is honestly EMPTY when no module of either kind is installed", async () => {
    const { res, body } = await getModels(false);
    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
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

// ---------------------------------------------------------------- S3_CHAT_BUCKET retirement
//
// Promoted from the throwaway probe that diagnosed vivijure-cf#140 on this host. The probe drove
// both branches (one bucket -> 200, split buckets -> 404) and proved local shipped the same defect
// LATENTLY, firing only when an operator set S3_CHAT_BUCKET. Now the knob is inert, so the split
// cannot be configured at all -- and that is what this asserts.
describe("S3_CHAT_BUCKET is retired (vivijure-cf#140)", () => {
  it("resolves the chat bucket to the main bucket even when the retired var is set", async () => {
    const { s3ConfigFromEnv } = await import("../src/platform/s3-config.js");
    const cfg = s3ConfigFromEnv({
      S3_ENDPOINT: "https://example.invalid",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET: "vivijure",
      S3_CHAT_BUCKET: "some-other-bucket",
    } as NodeJS.ProcessEnv);
    // The whole point: a configured split is IGNORED rather than honored into a broken state.
    expect(cfg?.chatBucket).toBe("vivijure");
    expect(cfg?.bucket).toBe("vivijure");
  });

  it("warns loudly when the retired var is set, naming it -- silent inertness would be its own trap", async () => {
    const { s3ConfigFromEnv } = await import("../src/platform/s3-config.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s3ConfigFromEnv({
      S3_ENDPOINT: "https://example.invalid",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET: "vivijure",
      S3_CHAT_BUCKET: "some-other-bucket",
    } as NodeJS.ProcessEnv);
    const warnings = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(warnings.some((w) => w.includes("S3_CHAT_BUCKET"))).toBe(true);
  });

  it("control: stays SILENT when the retired var is absent", async () => {
    const { s3ConfigFromEnv } = await import("../src/platform/s3-config.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s3ConfigFromEnv({
      S3_ENDPOINT: "https://example.invalid",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET: "vivijure",
    } as NodeJS.ProcessEnv);
    const warnings = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(warnings.some((w) => w.includes("S3_CHAT_BUCKET"))).toBe(false);
  });
});
