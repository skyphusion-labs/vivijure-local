import { describe, expect, it, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";
import { createPlanEnhanceTestFetcher } from "./plan-enhance-test-fetcher.js";

const SECRET = "c".repeat(32) + "d".repeat(32);
let dir: string;

class PlanEnhanceModuleTransport implements ModuleTransport {
  constructor(private readonly fetcher: FetcherLike) {}

  resolve(binding: string): FetcherLike | null {
    return binding === "MODULE_PLANENHANCE" ? this.fetcher : null;
  }

  listBindings(): string[] {
    return ["MODULE_PLANENHANCE"];
  }
}

function testPlatform(extraVars: Record<string, string | undefined> = {}): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-m7-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  const fetcher = createPlanEnhanceTestFetcher(join(dir, "renders"), {
    PLANNER_AI_MOCK: "true",
    ...extraVars,
  });
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: new PlanEnhanceModuleTransport(fetcher),
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, ...extraVars },
  };
}

function authJson(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
  );
}

const validStoryboard = {
  title: "neon_handoff",
  full_prompt: "A noir sci-fi short about a data handoff in the rain.",
  duration_seconds: 12,
  clip_seconds: 6,
  style_prefix: "cinematic neon noir",
  style_category: "None",
  style_preset: "None",
  use_characters: [] as string[],
  scenes: [
    { id: "shot_01", prompt: "a wide shot of a rain-soaked neon alley at night" },
    { id: "shot_02", prompt: "a close-up of the data handoff between two robots" },
  ],
};

afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env.PLANNER_AI_MOCK;
});

describe("GET /api/storyboard/models", () => {
  // Asserted against the module's DECLARED models, not the module name.
  //
  // This test previously expected an id of "plan-enhance" -- the no-enum projection case, where a
  // module that declares no model enum appears as one row under its own name. That was only true
  // because dev/manifests/plan-enhance.json was STALE: it predated cf#62 (#131), which gave the real
  // module a config_schema.model enum. So the local dev fleet was serving a planner catalog that did
  // not match the shipped module, and this test encoded that staleness rather than catching it.
  // Refreshing the manifest from source (scripts/sync-module-manifests.ts) fixed the fixture and
  // surfaced this. The enum case is the one the real module has.
  it("lists the models DECLARED by the installed plan.enhance module", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ id: string }> };
    expect(body.models.length).toBeGreaterThan(0);
    // ids are the declared model ids; the module NAME is not among them when an enum is declared
    expect(body.models.some((m) => m.id === "anthropic/claude-opus-4-8")).toBe(true);
    expect(body.models.some((m) => m.id === "plan-enhance")).toBe(false);
  });
});

describe("POST /api/storyboard/preflight", () => {
  it("unwraps the envelope and returns ok:true at 200", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/preflight", {
      method: "POST",
      body: JSON.stringify({ storyboard: validStoryboard, castBindings: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; counts: { error: number } };
    expect(body.ok).toBe(true);
    expect(body.counts.error).toBe(0);
  });

  it("surfaces validation errors as data at 200", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/preflight", {
      method: "POST",
      body: JSON.stringify({ storyboard: { scenes: validStoryboard.scenes } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; issues: Array<{ scope: string }> };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.scope === "storyboard")).toBe(true);
  });
});

describe("POST /api/storyboard/plan", () => {
  it("returns a valid storyboard via the plan.enhance module mock", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/plan", {
      method: "POST",
      body: JSON.stringify({
        brief: "A quiet harbor at dawn.",
        model: "plan-enhance",
        characters: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; storyboard?: { scenes: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.storyboard?.scenes?.length).toBeGreaterThan(0);
  });

  it("returns 422 when mock fail sentinel is in the brief", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/plan", {
      method: "POST",
      body: JSON.stringify({
        brief: "Test #mock-fail branch",
        model: "plan-enhance",
        characters: [],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; errors: string[] };
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("returns 422 when no plan.enhance module is installed", async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-m7-empty-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    const store = new FilesystemObjectStore(join(dir, "renders"));
    const emptyPlatform: Platform = {
      db: openDatabase(dbPath),
      renders: store,
      chatBucket: store,
      presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
      secrets: new EnvSecretStore({}),
      modules: { resolve: () => null, listBindings: () => [] },
      vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
    };
    const app = createApp(testSettingsHost(emptyPlatform));
    const res = await authJson(app, "/api/storyboard/plan", {
      method: "POST",
      body: JSON.stringify({
        brief: "A quiet harbor at dawn.",
        model: "plan-enhance",
        characters: [],
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/storyboard/refine", () => {
  it("refines via the plan.enhance module mock", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/refine", {
      method: "POST",
      body: JSON.stringify({
        storyboard: validStoryboard,
        message: "Add a third shot on the dock.",
        model: "plan-enhance",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
