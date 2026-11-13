// local#568 (and local#577): a THIRD-PARTY model is reachable only through the universal endpoint,
// POST /accounts/{id}/ai/run with the envelope { model, input }. The model-in-path URL that aiRun used
// for every model answers 400 code 7000 "No route for that URI" for a third-party model. Measured
// 2026-11-13 by free validation probes: vidu/q3-turbo and minimax/music-2.6 got 7000 on the path and a
// 7003 validation error plus a gateway log id on the envelope. Workers AI (@cf/) models keep the path.
//
// This file pins the transport in aiRun itself, then each third-party CALLER, because every one of
// them went through the broken route: the vidu door, music-gen, cloud-keyframe's proxied models, the
// cast.image fallback, and image.generate's proxied models. No spend: fetch is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiRunHttpError, aiRun, aiRunRetryable, isWorkersAiModel } from "../src/platform/ai-run.js";
import { invokeMusicGen, pollMusicGen } from "../src/modules/score/handlers.js";
import { generateCloudKeyframeImage } from "../src/modules/cloud-keyframe/image-gen.js";
import { generateCastImage } from "../src/modules/chain/cast-image-gen.js";
import { FLAG_FALLBACK_MODEL } from "../src/modules/chain/cast-image-core.js";
import { invokeImageGenerate } from "../src/modules/chain/image-generate-core.js";

const ACCT = "acct123";
const UNIVERSAL = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run`;
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCT, GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Call = { url: string; headers: Record<string, string>; body: unknown };
let calls: Call[];

/** Answers the documented universal-endpoint shape ({ result, state }) and serves provider media. */
function stub(result: Record<string, unknown>, status = 200) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://media.example/")) {
        return new Response(PNG, { status: 200, headers: { "content-type": url.endsWith(".mp3") ? "audio/mpeg" : "image/png" } });
      }
      let body: unknown = null;
      try { body = JSON.parse(String(init?.body ?? "null")); } catch { body = init?.body ?? null; }
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body });
      const payload = status === 200 ? { gatewayMetadata: { keySource: "Unified" }, result, state: "Completed" } : { success: false, errors: [{ code: 7003 }] };
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const aiCalls = () => calls.filter((c) => c.url.startsWith("https://api.cloudflare.com/"));

describe("aiRun transport (local#568)", () => {
  it("classifies model ids", () => {
    expect(isWorkersAiModel("@cf/deepgram/aura-1")).toBe(true);
    expect(isWorkersAiModel("@hf/thebloke/x")).toBe(true);
    for (const m of ["vidu/q3-turbo", "minimax/music-2.6", "google/nano-banana-pro", "openai/gpt-image-1.5", "recraft/recraftv4"]) {
      expect(isWorkersAiModel(m)).toBe(false);
    }
  });

  it("a third-party model goes to the universal envelope, with the gateway header", async () => {
    stub({ video: "https://media.example/v.mp4" });
    const out = await aiRun(ENV, "vidu/q3-turbo", { prompt: "p", duration: 5 });
    expect(aiCalls()).toHaveLength(1);
    const c = aiCalls()[0];
    expect(c.url).toBe(UNIVERSAL);
    expect(c.body).toEqual({ model: "vidu/q3-turbo", input: { prompt: "p", duration: 5 } });
    expect(c.headers["cf-aig-gateway-id"]).toBe("gw");
    expect(c.headers.Authorization).toBe("Bearer tok");
    expect(out).toEqual({ video: "https://media.example/v.mp4" });
  });

  it("a third-party model uses the envelope with no gateway configured too (token only)", async () => {
    stub({ video: "x" });
    await aiRun({ CLOUDFLARE_ACCOUNT_ID: ACCT, CLOUDFLARE_API_TOKEN: "cft" }, "minimax/music-2.6", { prompt: "p" });
    expect(aiCalls()[0].url).toBe(UNIVERSAL);
    expect(aiCalls()[0].headers["cf-aig-gateway-id"]).toBeUndefined();
  });

  it("a Workers AI (@cf) model keeps the model-in-path endpoint, params flat", async () => {
    stub({ response: "ok" });
    await aiRun(ENV, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: "p" });
    expect(aiCalls()[0].url).toBe(`${UNIVERSAL}/@cf/meta/llama-3.3-70b-instruct-fp8-fast`);
    expect(aiCalls()[0].body).toEqual({ prompt: "p" });
  });

  it("a non-2xx throws AiRunHttpError carrying the status; only 5xx/408/429/network are retryable", async () => {
    stub({}, 400);
    const e = (await aiRun(ENV, "vidu/q3-turbo", {}).catch((x: unknown) => x)) as AiRunHttpError;
    expect(e).toBeInstanceOf(AiRunHttpError);
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/^workers ai 400: /);
    expect(aiRunRetryable(e)).toBe(false);
    for (const s of [401, 403, 404, 422]) expect(aiRunRetryable(new AiRunHttpError(s, "x"))).toBe(false);
    for (const s of [500, 502, 503, 408, 429]) expect(aiRunRetryable(new AiRunHttpError(s, "x"))).toBe(true);
    expect(aiRunRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("every third-party aiRun caller now reaches the universal envelope (local#577)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vj-577-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("music-gen (minimax/music-2.6)", async () => {
    stub({ audio: "https://media.example/a.mp3" });
    const env = { ...ENV, ARTIFACT_ROOT: dir } as never;
    const r = await invokeMusicGen(env, {
      hook: "score", input: { film_key: "renders/p/film.mp4", storyboard: { title: "t", scenes: [{ prompt: "sea" }] } }, config: {},
      context: { project: "p", job_id: "m1" },
    } as never);
    expect(r).toMatchObject({ ok: true, pending: true });
    let p: { ok: boolean; pending?: boolean } = { ok: true, pending: true };
    for (let i = 0; i < 50 && p.ok && p.pending; i++) {
      await new Promise((res) => setTimeout(res, 10));
      p = (await pollMusicGen(env, { poll: (r as { poll: string }).poll } as never)) as typeof p;
    }
    expect(aiCalls()).toHaveLength(1);
    expect(aiCalls()[0].url).toBe(UNIVERSAL);
    expect((aiCalls()[0].body as { model: string }).model).toBe("minimax/music-2.6");
    expect((aiCalls()[0].body as { input: Record<string, unknown> }).input).toBeTypeOf("object");
    expect(p.ok && !p.pending).toBe(true);
  });

  it.each(["google/nano-banana", "openai/gpt-image-1.5"])("cloud-keyframe proxied model %s", async (model) => {
    stub({ image: "https://media.example/i.png" });
    const out = await generateCloudKeyframeImage(ENV, model, "a lighthouse", [], 1024, 576);
    expect(aiCalls()[0].url).toBe(UNIVERSAL);
    expect((aiCalls()[0].body as { model: string }).model).toBe(model);
    expect(out.bytes.byteLength).toBe(PNG.byteLength);
  });

  it("cast.image fallback model", async () => {
    stub({ image: "https://media.example/c.png" });
    await generateCastImage(ENV, FLAG_FALLBACK_MODEL, "portrait of Wren", []);
    expect(aiCalls()[0].url).toBe(UNIVERSAL);
    expect((aiCalls()[0].body as { model: string }).model).toBe(FLAG_FALLBACK_MODEL);
  });

  it.each(["google/nano-banana-pro", "openai/gpt-image-1.5", "recraft/recraftv4"])("image.generate proxied model %s", async (model) => {
    stub({ image: "https://media.example/g.png" });
    await invokeImageGenerate(ENV, {
      hook: "image.generate", input: { prompt: "a harbor" }, config: { model }, context: { project: "p", job_id: "j" },
    } as never);
    expect(aiCalls()[0].url).toBe(UNIVERSAL);
    expect((aiCalls()[0].body as { model: string }).model).toBe(model);
  });
});
