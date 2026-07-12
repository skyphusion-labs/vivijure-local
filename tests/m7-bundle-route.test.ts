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

const SECRET = "e".repeat(32) + "f".repeat(32);
let dir: string;

class EmptyModuleTransport implements ModuleTransport {
  resolve() {
    return null;
  }
  listBindings() {
    return [];
  }
}

function testPlatform(): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-bundle-route-"));
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
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
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

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/storyboard/bundle", () => {
  it("returns 201 with bundleKey on success", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/bundle", {
      method: "POST",
      body: JSON.stringify({
        storyboard: {
          title: "route_bundle",
          full_prompt: "test",
          duration_seconds: 8,
          clip_seconds: 4,
          style_prefix: "cinematic",
          style_category: "None",
          style_preset: "None",
          use_characters: [],
          scenes: [{ id: "shot_01", prompt: "a test scene" }],
        },
        characterRefs: {},
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; bundleKey?: string };
    expect(json.ok).toBe(true);
    expect(json.bundleKey).toBe("bundles/route_bundle.tar.gz");
  });

  it("returns 400 when characterRefs is missing", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await authJson(app, "/api/storyboard/bundle", {
      method: "POST",
      body: JSON.stringify({ storyboard: { title: "x", scenes: [] } }),
    });
    expect(res.status).toBe(400);
  });
});
