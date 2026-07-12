import { describe, expect, it, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";
import { MODULE_API, type ModulesResponse } from "@skyphusion-labs/vivijure-core";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const manifest = {
  name: "keyframe",
  version: "0.1.0",
  api: MODULE_API,
  hooks: ["keyframe"],
};

function fakeModule(body: unknown) {
  return {
    fetch: async () =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      }),
  } satisfies FetcherLike;
}

class StubModuleTransport implements ModuleTransport {
  constructor(private readonly fetchers: Map<string, FetcherLike>) {}

  resolve(binding: string): FetcherLike | null {
    return this.fetchers.get(binding) ?? null;
  }

  listBindings(): string[] {
    return [...this.fetchers.keys()].sort();
  }
}

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

function testPlatform(modules: ModuleTransport): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-m4-"));
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
    vars: {
      AUTH_MODE: "token",
      STUDIO_API_TOKEN: SECRET,
    },
  };
}

function modulesReq(app: ReturnType<typeof createApp>): Promise<Response> {
  return Promise.resolve(
    app.request("/api/modules", {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/modules", () => {
  it("discovers HTTP sidecar modules and projects render tiers", async () => {
    const transport = new StubModuleTransport(
      new Map([["MODULE_KEYFRAME", fakeModule(manifest)]]),
    );
    const app = createApp(testSettingsHost(testPlatform(transport)));
    const res = await modulesReq(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModulesResponse;
    expect(body.api).toBe(MODULE_API);
    expect(body.modules.map((m: { name: string }) => m.name)).toEqual(["keyframe"]);
    expect(body.hooks.keyframe).toEqual(["keyframe"]);
    expect(body.render.default_tier).toBe("final");
    expect(body.render.quality_tiers.length).toBe(3);
    expect(body.host).toEqual({ dispatch: false });
  });

  it("returns an empty catalog when no modules are bound", async () => {
    const app = createApp(testSettingsHost(testPlatform(new StubModuleTransport(new Map()))));
    const res = await modulesReq(app);
    const body = (await res.json()) as ModulesResponse;
    expect(body.modules).toEqual([]);
    expect(body.catalog.length).toBeGreaterThan(0);
  });
});
