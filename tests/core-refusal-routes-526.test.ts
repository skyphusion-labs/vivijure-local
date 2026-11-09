// local#520, local#525: send the bad input to the real route, assert the client error, never 500.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { MODULE_API, _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

function platform(modules: ModuleTransport): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-526-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath), renders: store, chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}), modules,
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}
const none: ModuleTransport = { resolve: () => null, listBindings: () => [] };
const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  Promise.resolve(app.request(path, {
    method, headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
const board = (title: string) => ({ title, scenes: [{ shot_id: "s1", prompt: "p", seconds: 4 }] });

beforeEach(() => _resetModuleDiscoveryCache());
afterEach(() => { _resetModuleDiscoveryCache(); if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("409: a board whose title key another project holds (core#518, PR core#519)", () => {
  const seeded = async () => {
    const app = createApp(testSettingsHost(platform(none)));
    const a = (await (await call(app, "POST", "/api/storyboard/projects", { name: "A" })).json()) as { project: { id: string } };
    expect((await call(app, "POST", `/api/storyboard/projects/${a.project.id}/storyboard`, { storyboard: board("Shared Title") })).status).toBe(200);
    const b = (await (await call(app, "POST", "/api/storyboard/projects", { name: "B" })).json()) as { project: { id: string } };
    return { app, a: a.project.id, b: b.project.id };
  };
  it("POST /api/storyboard/projects/:id/storyboard", async () => {
    const { app, b } = await seeded();
    const r = await call(app, "POST", `/api/storyboard/projects/${b}/storyboard`, { storyboard: board("Shared Title") });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain(`project "A"`);
  });
  it("PATCH /api/storyboard/projects/:id with storyboard", async () => {
    const { app, b } = await seeded();
    const r = await call(app, "PATCH", `/api/storyboard/projects/${b}`, { storyboard: board("Shared Title") });
    expect(r.status).toBe(409);
  });
  it("CONTROL: saving a project's own board again is 200", async () => {
    const { app, a } = await seeded();
    expect((await call(app, "POST", `/api/storyboard/projects/${a}/storyboard`, { storyboard: board("Shared Title") })).status).toBe(200);
  });
});

describe("400: an enum value the module does not declare (core#343, PR core#517)", () => {
  const keyframe = {
    name: "keyframe", version: "0.1.0", api: MODULE_API, hooks: ["keyframe"],
    config_schema: { style: { type: "enum", values: ["photoreal", "anime"], default: "photoreal" } },
  };
  const transport: ModuleTransport = {
    listBindings: () => ["MODULE_KEYFRAME"],
    resolve: () => ({ fetch: async () => new Response(JSON.stringify(keyframe), { headers: { "content-type": "application/json" } }) }) satisfies FetcherLike,
  };
  it("POST /api/storyboard/render with a bad keyframe style answers 400 naming it", async () => {
    const app = createApp(testSettingsHost(platform(transport)));
    const r = await call(app, "POST", "/api/storyboard/render", {
      bundleKey: "bundles/demo.tar.gz", scenes: [{ shot_id: "s1", prompt: "p", seconds: 4 }], keyframesOnly: true,
      renderOverrides: { keyframe_backend: "keyframe", config: { keyframe: { style: "watercolor" } } },
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain(`"style": "watercolor" is not supported`);
  });
});
