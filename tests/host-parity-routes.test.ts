import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import type { Platform } from "../src/platform/types.js";
import { selectSeedKeys } from "../src/cast-image-orchestrator.js";
import { validateManifest, CAST_BUNDLE_FORMAT } from "../src/cast-bundle.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

function auth() {
  return { authorization: `Bearer ${SECRET}` };
}

function makePlatform(root: string): Platform {
  const dbPath = join(root, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(root);
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, PLANNER_AI_MOCK: "true" },
  };
}

describe("cast-image-orchestrator pure helpers", () => {
  it("selectSeedKeys caps and dedupes", () => {
    expect(
      selectSeedKeys("p1", [{ key: "s1" }, { key: "s2" }], ["s2", "s1"], 3),
    ).toEqual(["p1", "s2", "s1"]);
  });
});

describe("cast-bundle validateManifest", () => {
  it("rejects wrong format", () => {
    expect(() => validateManifest({ format: "other" })).toThrow(/not a vivijure cast bundle/);
  });

  it("accepts minimal valid manifest", () => {
    const m = validateManifest({
      format: CAST_BUNDLE_FORMAT,
      schema_version: 1,
      cast: { name: "Wren", bible: null, voice_id: null, lora_status: "idle", lora_trained_at: null },
      assets: { portrait: null, refs: [], sources: [], lora: null },
    });
    expect(m.cast.name).toBe("Wren");
  });
});

describe("host parity routes", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-parity-"));
    app = createApp(testSettingsHost(makePlatform(dir)));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/storyboard/renders returns empty library", async () => {
    const res = await app.request("/api/storyboard/renders", { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { renders: unknown[] };
    expect(body.renders).toEqual([]);
  });

  it("POST /api/storyboard/enhance passes through with no modules", async () => {
    const storyboard = { scenes: [{ shot_id: "s1", prompt: "test", seconds: 4 }] };
    const res = await app.request("/api/storyboard/enhance", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ storyboard, brief: "more drama" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; storyboard: typeof storyboard };
    expect(body.ok).toBe(true);
    expect(body.storyboard.scenes).toHaveLength(1);
  });

  it("POST /api/chat requires model and user_input", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ model: "anthropic/claude-sonnet-4-6" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/storyboard/render/scatter requires shotIds", async () => {
    const res = await app.request("/api/storyboard/render/scatter", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ bundleKey: "bundles/demo.tar.gz", shotIds: ["only-one"] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/cast/:id/generate-refs fails without portrait or sources", async () => {
    const create = await app.request("/api/cast", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "Empty" }),
    });
    const { cast } = (await create.json()) as { cast: { id: string } };
    const res = await app.request(`/api/cast/${cast.id}/generate-refs`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { phase: string; error?: string };
    expect(body.phase).toBe("failed");
    expect(body.error).toMatch(/no portrait or source/);
  });

  it("GET /api/cast/export/:id 404s for unknown cast", async () => {
    const res = await app.request("/api/cast/export/cst_00000000000000000000000000", {
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/cast/:id/train-wan-lora fails closed without RUNPOD_WAN_TRAIN_ENDPOINT_ID", async () => {
    const create = await app.request("/api/cast", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "Wren" }),
    });
    const { cast } = (await create.json()) as { cast: { id: string } };
    const res = await app.request(`/api/cast/${cast.id}/train-wan-lora`, {
      method: "POST",
      headers: auth(),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
