// local#568: the generic gateway i2v runner, with cf's paid-generation guarantees. No spend: the
// provider call and the media fetch are stubs; storage is the real filesystem store.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { door } from "../src/modules/gateway-i2v/doors/cf-vidu-q3-turbo.js";
import {
  invokeGatewayI2v,
  pollGatewayI2v,
  NOT_STORED_ERROR,
  NO_VIDEO_URL_ERROR,
  RESTARTED_ERROR,
  type GatewayI2vContext,
} from "../src/modules/gateway-i2v/runner.js";
import { createGatewayI2vApp } from "../src/modules/gateway-i2v/app.js";
import { keyframeHostRefusal } from "../src/modules/gateway-i2v/keyframe-host.js";

const GATEWAY = { CLOUDFLARE_ACCOUNT_ID: "acct", GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" };
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);
const INPUT = { shot_id: "s1", keyframe_url: "https://media.example.com/k.png", prompt: "a lighthouse", seconds: 5 };
const REQ = { hook: "motion.backend", input: INPUT, config: {}, context: { project: "proj", job_id: "film-1" } };

let dir: string;
let store: FilesystemObjectStore;
let generated: { model: string; params: Record<string, unknown> }[];
let runs: Promise<void>[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vj-568-"));
  store = new FilesystemObjectStore(join(dir, "renders"));
  generated = [];
  runs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function ctx(over: Partial<GatewayI2vContext> = {}): GatewayI2vContext {
  return {
    env: GATEWAY,
    store: store as never,
    bootId: "boot-a",
    generate: async (model, params) => {
      generated.push({ model, params });
      return { video: "https://provider.example/clip.mp4" };
    },
    fetchMedia: async () => new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } }),
    sleep: async () => {},
    onRun: (p) => runs.push(p),
    ...over,
  };
}

async function invokeAndSettle(c: GatewayI2vContext) {
  const r = await invokeGatewayI2v(c, door as never, REQ as never);
  await Promise.all(runs);
  return r;
}

describe("gateway i2v runner (local#568)", () => {
  it("happy path: one paid call, clip stored, poll returns cf's MotionBackendOutput", async () => {
    const c = ctx();
    const r = await invokeAndSettle(c);
    expect(r).toMatchObject({ ok: true, pending: true, jobId: "film-1-s1" });
    expect(generated).toEqual([
      { model: "vidu/q3-turbo", params: { prompt: "a lighthouse", start_image: INPUT.keyframe_url, duration: 5, resolution: "720p", audio: true } },
    ]);
    const p = await pollGatewayI2v(c, door as never, { poll: (r as { poll: string }).poll });
    expect(p).toEqual({
      ok: true,
      output: { shot_id: "s1", clip_key: "renders/proj/clips/s1_cf-vidu-q3-turbo.mp4", fps: 24, frames: 120, has_audio: true },
    });
    const stored = await store.getBytes("renders/proj/clips/s1_cf-vidu-q3-turbo.mp4");
    expect(stored && Array.from(stored.bytes)).toEqual(Array.from(MP4));
  });

  it("a generate that throws is retried, at most twice", async () => {
    let n = 0;
    const c = ctx({ generate: async () => { n++; throw new Error("gateway 502"); } });
    const r = await invokeAndSettle(c);
    expect(n).toBe(3);
    const p = await pollGatewayI2v(c, door as never, { poll: (r as { poll: string }).poll });
    expect(p).toEqual({ ok: false, error: "gateway 502" });
  });

  it("a completed call with no URL fails once, and is not bought again", async () => {
    let n = 0;
    const c = ctx({ generate: async () => { n++; return { state: "Completed" }; } });
    const r = await invokeAndSettle(c);
    expect(n).toBe(1);
    expect(await pollGatewayI2v(c, door as never, { poll: (r as { poll: string }).poll })).toEqual({ ok: false, error: NO_VIDEO_URL_ERROR });
  });

  it("a store failure after a successful call retries the DOWNLOAD only and reports cf's NOT_STORED text", async () => {
    let fetches = 0;
    const c = ctx({ fetchMedia: async () => { fetches++; return new Response("gone", { status: 404 }); } });
    const r = await invokeAndSettle(c);
    expect(generated).toHaveLength(1); // the provider is called exactly once
    expect(fetches).toBe(3);
    expect(await pollGatewayI2v(c, door as never, { poll: (r as { poll: string }).poll })).toEqual({ ok: false, error: NOT_STORED_ERROR });
  });

  it("a non-media download is refused, not stored", async () => {
    const c = ctx({ fetchMedia: async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) });
    const r = await invokeAndSettle(c);
    expect(await pollGatewayI2v(c, door as never, { poll: (r as { poll: string }).poll })).toEqual({ ok: false, error: NOT_STORED_ERROR });
    expect(await store.getBytes("renders/proj/clips/s1_cf-vidu-q3-turbo.mp4")).toBeNull();
  });

  it("a running job from another boot is an orphan: failed, never re-run", async () => {
    const c = ctx({ generate: () => new Promise(() => {}) }); // in flight, never settles
    const r = await invokeGatewayI2v(c, door as never, REQ as never);
    const poll = (r as { poll: string }).poll;
    expect(await pollGatewayI2v(c, door as never, { poll })).toEqual({ ok: true, pending: true });
    const restarted = ctx({ bootId: "boot-b" });
    expect(await pollGatewayI2v(restarted, door as never, { poll })).toEqual({ ok: false, error: RESTARTED_ERROR });
    expect(generated).toHaveLength(0);
    expect(await pollGatewayI2v(c, door as never, { poll })).toEqual({ ok: false, error: RESTARTED_ERROR });
  });

  it("refuses before any spend: bad input, no gateway, a keyframe the provider cannot reach", async () => {
    const bad = await invokeGatewayI2v(ctx(), door as never, { ...REQ, input: { ...INPUT, prompt: "" } } as never);
    expect(bad).toEqual({ ok: false, error: "motion.backend: input needs shot_id, keyframe_url, and prompt", reason: "bad-input" });
    const noGw = await invokeGatewayI2v(ctx({ env: {} }), door as never, REQ as never);
    expect(noGw).toMatchObject({ ok: false, reason: "not-configured" });
    expect((noGw as { error: string }).error).toMatch(/CLOUDFLARE_ACCOUNT_ID, GATEWAY_ID and CF_AIG_TOKEN/);
    for (const u of ["http://127.0.0.1:8790/k.png", "http://192.168.1.4:9000/k.png", "http://minio:9000/k.png".replace("minio", "nas.local")]) {
      const r = await invokeGatewayI2v(ctx(), door as never, { ...REQ, input: { ...INPUT, keyframe_url: u } } as never);
      expect(r).toMatchObject({ ok: false, reason: "not-configured" });
      expect((r as { error: string }).error).toMatch(/S3_PRESIGN_ENDPOINT.*docs\/EDGE\.md/);
    }
    const end = await invokeGatewayI2v(ctx(), door as never, { ...REQ, input: { ...INPUT, last_keyframe_url: "http://10.0.0.2/e.png" } } as never);
    expect(end).toMatchObject({ ok: false, reason: "not-configured" });
    await Promise.all(runs);
    expect(generated).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it("poll: bad token and missing state, in cf's words", async () => {
    expect(await pollGatewayI2v(ctx(), door as never, { poll: "!!" })).toEqual({ ok: false, error: "cf-vidu-q3-turbo: bad poll token" });
    const tok = Buffer.from(JSON.stringify({ job_id: "nope" })).toString("base64");
    expect(await pollGatewayI2v(ctx(), door as never, { poll: tok })).toEqual({
      ok: false,
      error: "cf-vidu-q3-turbo: run state not found (expired or bad token)",
    });
  });
});

describe("keyframeHostRefusal (local#568 ruling)", () => {
  it.each([
    "http://127.0.0.1:8790/a", "http://localhost/a", "http://10.1.2.3/a", "http://172.16.0.1/a", "http://172.31.9.9/a",
    "http://192.168.0.2/a", "http://169.254.1.1/a", "http://100.64.0.1/a", "http://[::1]/a", "http://[fd00::1]/a",
    "http://[::ffff:192.168.1.1]/a", "http://nas.local/a", "http://app.localhost/a",
  ])("refuses %s", (u) => expect(keyframeHostRefusal(u)).toMatch(/not reachable from the internet/));
  it.each(["https://media.example.com/a", "https://172.32.0.1/a", "https://8.8.8.8/a", "https://[2606:4700::1]/a"])(
    "allows %s",
    (u) => expect(keyframeHostRefusal(u)).toBeNull(),
  );
  it("absent is not a refusal; garbage is", () => {
    expect(keyframeHostRefusal(undefined)).toBeNull();
    expect(keyframeHostRefusal("not a url")).toMatch(/not a valid URL/);
  });
});

describe("the sidecar app (local#568)", () => {
  const manifest = { name: "cf-vidu-q3-turbo", hooks: ["motion.backend"] };
  it("module.json carries configured from the gateway creds (local#201 mechanism)", async () => {
    const off = createGatewayI2vApp(manifest, door as never, async () => ctx({ env: {} }));
    const on = createGatewayI2vApp(manifest, door as never, async () => ctx());
    expect(await (await off.request("/module.json")).json()).toEqual({ ...manifest, configured: false });
    expect(await (await on.request("/module.json")).json()).toEqual({ ...manifest, configured: true });
  });
  it("invoke refuses a wrong hook and bad JSON, as cf does", async () => {
    const app = createGatewayI2vApp(manifest, door as never, async () => ctx());
    const wrong = await app.request("/invoke", { method: "POST", body: JSON.stringify({ hook: "keyframe" }) });
    expect(await wrong.json()).toEqual({ ok: false, error: "unsupported hook keyframe", reason: "unsupported" });
    const junk = await app.request("/invoke", { method: "POST", body: "{" });
    expect(await junk.json()).toEqual({ ok: false, error: "invalid JSON body", reason: "bad-input" });
    const noTok = await app.request("/poll", { method: "POST", body: "{}" });
    expect(await noTok.json()).toEqual({ ok: false, error: "poll token required" });
  });
});
