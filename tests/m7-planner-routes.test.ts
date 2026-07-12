import { describe, expect, it, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import type { ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "c".repeat(32) + "d".repeat(32);
let dir: string;

class EmptyModuleTransport implements ModuleTransport {
  resolve() {
    return null;
  }
  listBindings() {
    return [];
  }
}

function testPlatform(extraVars: Record<string, string | undefined> = {}): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-m7-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: new EmptyModuleTransport(),
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
  it("returns a valid storyboard when PLANNER_AI_MOCK is enabled", async () => {
    process.env.PLANNER_AI_MOCK = "true";
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/plan", {
      method: "POST",
      body: JSON.stringify({
        brief: "A quiet harbor at dawn.",
        model: "anthropic/claude-opus-4-8",
        characters: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; storyboard?: { scenes: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.storyboard?.scenes?.length).toBeGreaterThan(0);
  });

  it("returns 422 when mock fail sentinel is in the brief", async () => {
    process.env.PLANNER_AI_MOCK = "true";
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/plan", {
      method: "POST",
      body: JSON.stringify({
        brief: "Test #mock-fail branch",
        model: "anthropic/claude-opus-4-8",
        characters: [],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; errors: string[] };
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe("POST /api/storyboard/refine", () => {
  it("refines with mock enabled", async () => {
    process.env.PLANNER_AI_MOCK = "true";
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/refine", {
      method: "POST",
      body: JSON.stringify({
        storyboard: validStoryboard,
        message: "Add a third shot on the dock.",
        model: "anthropic/claude-opus-4-8",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
