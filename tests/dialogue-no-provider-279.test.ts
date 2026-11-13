// local#279, lead ruling B with A as the backstop. A studio with no speech provider refuses a voiced
// storyboard AT THE DOOR, before any keyframe or clip job, with a 400 that names the fixes. dialogue-gen
// itself refuses anything that still reaches it with spoken lines, instead of writing a silent WAV.
//
// SEAM: the REAL routes and the real animateFromPreview, against a real voiced bundle. Module discovery
// is replaced so the test chooses whether a dialogue provider exists. core's two start functions are
// replaced so the test can see whether a job was started at all: they are the only path that submits
// keyframe or clip jobs, so "not called" IS "zero spend". fetch is stubbed too, and must see no call.
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

const KEYFRAME = { name: "keyframe", binding: "MODULE_KEYFRAME", version: "1.0.0", api: "vivijure-module/2", hooks: ["keyframe"], ui: { order: 1, locality: "local" } };
const DOOR = { name: "door", binding: "MODULE_DOOR", version: "1.0.0", api: "vivijure-module/2", hooks: ["motion.backend"], ui: { order: 1, locality: "local" } };
const DIALOGUE = { name: "dialogue-gen", binding: "MODULE_DIALOGUE", version: "1.0.0", api: "vivijure-module/2", hooks: ["dialogue"], ui: { order: 1 } };
let modules: unknown[] = [];
vi.mock("../src/module-registry.js", async (orig) => {
  const actual = await orig<typeof import("../src/module-registry.js")>();
  return { ...actual, discoverConfiguredModules: vi.fn(async () => modules) };
});

import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import type { Platform } from "../src/platform/types.js";
import { animateFromPreview } from "../src/finalize-from-keyframes.js";
import { NO_SPEECH_PROVIDER_MESSAGE } from "../src/render-dialogue.js";
import { createChainModuleApp } from "../src/modules/chain/app.js";
import { invokeDialogueGen, pollDialogueGen, NO_SPEECH_PROVIDER_ERROR } from "../src/modules/chain/handlers.js";
import { encodePoll, stateKey } from "../src/modules/chain/dialogue-gen-core.js";
import { isModuleConfigured } from "../src/module-registry.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import { bundleTarGz, storyboardYaml } from "./helpers/voiced-bundle.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
const KEY = "bundles/b.tar.gz";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VOICED = storyboardYaml([
  { id: "s1", prompt: "a lighthouse", line: { slot: "A", text: "The lamp is out." } },
  { id: "s2", prompt: "the sea" },
]);
const SILENT = storyboardYaml([
  { id: "s1", prompt: "a lighthouse" },
  { id: "s2", prompt: "the sea" },
]);
const SCENES = [
  { shot_id: "s1", prompt: "a lighthouse", seconds: 4 },
  { shot_id: "s2", prompt: "the sea", seconds: 4 },
];
const GATEWAY = { CLOUDFLARE_ACCOUNT_ID: "acct", GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" };

let dir: string;
let platform: Platform;
let fetched: string[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  captured.length = 0;
  fetched = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  dir = mkdtempSync(join(tmpdir(), "vj-279-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  platform = {
    db: openDatabase(dbPath), renders: store, chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}), modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function bundle(yaml: string): Promise<void> {
  await platform.renders.put(KEY, bundleTarGz(yaml, { "clips/s1_keyframe.png": PNG, "clips/s2_keyframe.png": PNG }));
}
function post(path: string, body: unknown): Promise<Response> {
  const app = createApp(testSettingsHost(platform));
  return Promise.resolve(app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}
const PARENT = {
  id: 7, project: "p", bundle_key: KEY, mode: "keyframes-only", status: "COMPLETED", quality_tier: "final",
  keyframes: [{ shot_id: "s1", key: "k/s1.png" }, { shot_id: "s2", key: "k/s2.png" }],
  output: { scenes: SCENES }, render_overrides: null,
};

describe("door refusal: a voiced storyboard on a studio with no speech provider (0 spend)", () => {
  beforeEach(() => { modules = [KEYFRAME, DOOR]; });

  it("main Render refuses 400 naming the fixes, and starts no job", async () => {
    await bundle(VOICED);
    const res = await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, motion_backend: "door" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(NO_SPEECH_PROVIDER_MESSAGE);
    expect(NO_SPEECH_PROVIDER_MESSAGE).toMatch(/AI Gateway credentials.*keyframes-only.*remove the spoken lines/);
    expect(captured).toHaveLength(0);
    expect(fetched).toEqual([]);
  });

  it("render-from-keyframes refuses 400 and starts no job", async () => {
    await bundle(VOICED);
    const res = await post("/api/storyboard/render-from-keyframes", { bundleKey: KEY });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(NO_SPEECH_PROVIDER_MESSAGE);
    expect(captured).toHaveLength(0);
    expect(fetched).toEqual([]);
  });

  it("finalize refuses 400 and starts no job", async () => {
    await bundle(VOICED);
    const r = await animateFromPreview(orchestratorContextFromPlatform(platform), { parent: PARENT as never, deriveMode: "finalized" });
    expect(r).toEqual({ ok: false, error: NO_SPEECH_PROVIDER_MESSAGE, status: 400 });
    expect(captured).toHaveLength(0);
    expect(fetched).toEqual([]);
  });

  it("a keyframes-only preview of a voiced storyboard still runs (it voices nothing)", async () => {
    await bundle(VOICED);
    await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, keyframesOnly: true });
    expect(captured.map((c) => c.fn)).toEqual(["startFilmJob"]);
  });

  it("a SILENT storyboard still renders on a provider-less studio", async () => {
    await bundle(SILENT);
    const res = await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, motion_backend: "door" });
    expect(res.status).toBe(500); // the sentinel: the start call was reached
    expect(captured.map((c) => c.fn)).toEqual(["startFilmJob"]);
    expect(captured[0].args.dialogue_lines).toBeUndefined();
  });
});

describe("a voiced storyboard still renders where a speech provider exists", () => {
  beforeEach(() => { modules = [KEYFRAME, DOOR, DIALOGUE]; });

  it("main Render starts the film with the lines", async () => {
    await bundle(VOICED);
    await post("/api/storyboard/render", { bundleKey: KEY, scenes: SCENES, motion_backend: "door" });
    expect(captured.map((c) => c.fn)).toEqual(["startFilmJob"]);
    expect((captured[0].args.dialogue_lines as { text: string }[]).map((l) => l.text)).toEqual(["The lamp is out."]);
  });

  it("finalize starts the film with the lines", async () => {
    await bundle(VOICED);
    await expect(
      animateFromPreview(orchestratorContextFromPlatform(platform), { parent: PARENT as never, deriveMode: "finalized" }),
    ).rejects.toThrow(/sentinel/);
    expect(captured.map((c) => c.fn)).toEqual(["startFilmFromKeyframes"]);
  });
});

describe("dialogue-gen: no provider means hidden, and refused if reached (backstop)", () => {
  const MANIFEST = { name: "dialogue-gen", version: "0.1.0", api: "vivijure-module/2", hooks: ["dialogue"] };
  const app = (env: Record<string, string>) =>
    createChainModuleApp(MANIFEST, "dialogue-gen", async () => ({ env: env as never, store: platform.renders as never }));

  it("module.json says configured:false with no gateway, so discovery drops it", async () => {
    const off = (await (await app({}).request("/module.json")).json()) as { configured?: boolean };
    expect(off.configured).toBe(false);
    expect(isModuleConfigured(off as never)).toBe(false);
    const on = (await (await app(GATEWAY).request("/module.json")).json()) as { configured?: boolean };
    expect(on.configured).toBe(true);
    expect(isModuleConfigured(on as never)).toBe(true);
  });

  it("other chain modules' module.json is unchanged (no configured field)", async () => {
    const pe = createChainModuleApp({ name: "plan-enhance", hooks: ["plan.enhance"] }, "plan-enhance", async () => ({ env: {} as never, store: platform.renders as never }));
    const body = (await (await pe.request("/module.json")).json()) as Record<string, unknown>;
    expect("configured" in body).toBe(false);
  });

  it("invoke with spoken lines and no gateway refuses, and writes nothing", async () => {
    const r = await invokeDialogueGen({} as never, platform.renders as never, {
      hook: "dialogue", input: { project: "p", lines: [{ shot_id: "s1", text: "Hello." }] }, config: {},
      context: { job_id: "j1" },
    } as never);
    expect(r).toEqual({ ok: false, error: NO_SPEECH_PROVIDER_ERROR });
    expect(await platform.renders.get(stateKey("j1"))).toBeNull();
  });

  it("an in-flight run polled with no gateway fails; no silent WAV is written", async () => {
    await platform.renders.put(stateKey("j2"), JSON.stringify({
      status: "running", started_at: 0, project: "p", next_index: 0, audio: [],
      lines: [{ shot_id: "s1", text: "Hello.", voice: "angus" }],
    }));
    const r = await pollDialogueGen({} as never, platform.renders as never, { poll: encodePoll({ job_id: "j2" }) } as never);
    expect(r).toEqual({ ok: false, error: NO_SPEECH_PROVIDER_ERROR });
    expect(await platform.renders.get("renders/p/dialogue/s1.wav")).toBeNull();
  });

  it("an empty batch is still fine with no gateway (nothing to voice)", async () => {
    const r = await invokeDialogueGen({} as never, platform.renders as never, {
      hook: "dialogue", input: { project: "p", lines: [] }, config: {},
    } as never);
    expect(r.ok).toBe(true);
  });
});
