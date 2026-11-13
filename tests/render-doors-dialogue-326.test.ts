// local#326: the main Render door and the finalize family used to start films with NO dialogue_lines,
// so a voiced storyboard rendered silent with a 201. This drives the REAL route / handler against a
// real voiced bundle and captures what reaches core's start functions. Only module discovery and the
// two start functions are replaced: discovery so no sidecar is needed, the start functions so the test
// can read their arguments (they throw a sentinel error, so nothing renders).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const captured: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock("@skyphusion-labs/vivijure-core/film-orchestrator", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/film-orchestrator")>();
  const capture = (fn: string) =>
    vi.fn(async (_env: unknown, args: Record<string, unknown>) => {
      captured.push({ fn, args });
      throw new Error("sentinel: start captured");
    });
  return { ...actual, startFilmJob: capture("startFilmJob"), startFilmFromKeyframes: capture("startFilmFromKeyframes") };
});

const MODULES = [
  { name: "keyframe", binding: "MODULE_KEYFRAME", version: "1.0.0", api: "vivijure-module/2", hooks: ["keyframe"], ui: { order: 1, locality: "local" } },
  { name: "door", binding: "MODULE_DOOR", version: "1.0.0", api: "vivijure-module/2", hooks: ["motion.backend"], ui: { order: 1, locality: "local" } },
];
vi.mock("../src/module-registry.js", async (orig) => {
  const actual = await orig<typeof import("../src/module-registry.js")>();
  return { ...actual, discoverConfiguredModules: vi.fn(async () => MODULES) };
});

import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import type { Platform } from "../src/platform/types.js";
import { animateFromPreview } from "../src/finalize-from-keyframes.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import { bundleTarGz, storyboardYaml } from "./helpers/voiced-bundle.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
const KEY = "bundles/voiced.tar.gz";
let dir: string;
let platform: Platform;

beforeEach(async () => {
  captured.length = 0;
  dir = mkdtempSync(join(tmpdir(), "vj-326-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  platform = {
    db: openDatabase(dbPath), renders: store, chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}), modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
  const yaml = storyboardYaml([
    { id: "s1", prompt: "a lighthouse", line: { slot: "A", text: "The lamp is out." } },
    { id: "s2", prompt: "the sea" },
  ]);
  await store.put(KEY, bundleTarGz(yaml));
});
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function post(path: string, body: unknown): Promise<Response> {
  const app = createApp(testSettingsHost(platform));
  return Promise.resolve(app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const SCENES = [
  { shot_id: "s1", prompt: "a lighthouse", seconds: 4 },
  { shot_id: "s2", prompt: "the sea", seconds: 4 },
];

describe("main Render door (POST /api/storyboard/render) voices the storyboard", () => {
  it("passes the authored lines to startFilmJob", async () => {
    const res = await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, motion_backend: "door" });
    expect(captured.map((c) => c.fn)).toEqual(["startFilmJob"]);
    expect(res.status).toBe(500); // the sentinel thrown by the captured start call
    const lines = captured[0].args.dialogue_lines as { shot_id: string; text: string }[];
    expect(lines.map((l) => [l.shot_id, l.text])).toEqual([["s1", "The lamp is out."]]);
  });

  it("a keyframes-only preview asks for no dialogue", async () => {
    await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, keyframesOnly: true });
    expect(captured[0].args.dialogue_lines).toBeUndefined();
  });

  it("refuses 503 and starts nothing when the bundle cannot be read", async () => {
    await platform.renders.put(KEY, new Uint8Array([0x1f, 0x8b, 9, 9, 9]));
    const res = await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, motion_backend: "door" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not determine whether this storyboard has spoken lines/);
    expect(captured).toHaveLength(0);
  });
});

describe("finalize family (animateFromPreview) voices the preview", () => {
  const parent = {
    id: 7, project: "p", bundle_key: KEY, mode: "keyframes-only", status: "COMPLETED", quality_tier: "final",
    keyframes: [{ shot_id: "s1", key: "k/s1.png" }, { shot_id: "s2", key: "k/s2.png" }],
    output: { scenes: SCENES }, render_overrides: null,
  };

  it("passes the authored lines to startFilmFromKeyframes", async () => {
    const env = orchestratorContextFromPlatform(platform);
    await expect(
      animateFromPreview(env, { parent: parent as never, deriveMode: "finalized" }),
    ).rejects.toThrow(/sentinel/);
    expect(captured.map((c) => c.fn)).toEqual(["startFilmFromKeyframes"]);
    const lines = captured[0].args.dialogue_lines as { shot_id: string; text: string }[];
    expect(lines.map((l) => [l.shot_id, l.text])).toEqual([["s1", "The lamp is out."]]);
  });

  it("judges only the locked shots it finalizes", async () => {
    const env = orchestratorContextFromPlatform(platform);
    await expect(
      animateFromPreview(env, { parent: { ...parent, locked_shots: ["s2"] } as never, deriveMode: "finalized" }),
    ).rejects.toThrow(/sentinel/);
    expect(captured[0].args.dialogue_lines).toBeUndefined();
  });

  it("refuses 503 and starts nothing when the bundle cannot be read", async () => {
    await platform.renders.put(KEY, new Uint8Array([0x1f, 0x8b, 9, 9, 9]));
    const env = orchestratorContextFromPlatform(platform);
    const r = await animateFromPreview(env, { parent: parent as never, deriveMode: "finalized" });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(captured).toHaveLength(0);
  });
});

describe("render-from-keyframes door (POST /api/storyboard/render-from-keyframes) voices the bundle", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const yaml = storyboardYaml([
    { id: "s1", prompt: "a lighthouse", line: { slot: "A", text: "The lamp is out." } },
    { id: "s2", prompt: "the sea" },
  ]);

  it("passes the authored lines to startFilmFromKeyframes", async () => {
    await platform.renders.put(KEY, bundleTarGz(yaml, { "clips/s1_keyframe.png": PNG, "clips/s2_keyframe.png": PNG }));
    const res = await post("/api/storyboard/render-from-keyframes", { bundleKey: KEY });
    expect(captured.map((c) => c.fn)).toEqual(["startFilmFromKeyframes"]);
    expect(res.status).toBe(500); // the sentinel thrown by the captured start call
    const lines = captured[0].args.dialogue_lines as { shot_id: string; text: string }[];
    expect(lines.map((l) => [l.shot_id, l.text])).toEqual([["s1", "The lamp is out."]]);
  });
});
