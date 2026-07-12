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
import { MODULE_API } from "@skyphusion-labs/vivijure-core";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

class EmptyModuleTransport implements ModuleTransport {
  resolve() {
    return null;
  }
  listBindings() {
    return [];
  }
}

function testPlatform(modules: ModuleTransport): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-m5-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules,
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
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/storyboard/render", () => {
  it("returns 503 when no keyframe module is bound", async () => {
    const app = createApp(testSettingsHost(testPlatform(new EmptyModuleTransport())));
    const res = await authJson(app, "/api/storyboard/render", {
      method: "POST",
      body: JSON.stringify({
        bundleKey: "bundles/demo.tar.gz",
        scenes: [{ shot_id: "s1", prompt: "test", seconds: 4 }],
      }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 400 when scenes are missing", async () => {
    const transport: ModuleTransport = {
      listBindings: () => ["MODULE_KEYFRAME"],
      resolve: () =>
        ({
          fetch: async () =>
            new Response(
              JSON.stringify({
                name: "keyframe",
                version: "0.1.0",
                api: MODULE_API,
                hooks: ["keyframe"],
              }),
              { headers: { "content-type": "application/json" } },
            ),
        }) satisfies FetcherLike,
    };
    const app = createApp(testSettingsHost(testPlatform(transport)));
    const res = await authJson(app, "/api/storyboard/render", {
      method: "POST",
      body: JSON.stringify({ bundleKey: "bundles/demo.tar.gz", scenes: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/storyboard/render/:jobId", () => {
  it("returns 404 for non-film job ids", async () => {
    const app = createApp(testSettingsHost(testPlatform(new EmptyModuleTransport())));
    const res = await authJson(app, "/api/storyboard/render/runpod-legacy-id");
    expect(res.status).toBe(404);
  });
});
