// local's in-process image.generate module (cf#129).
//
// The point of this module is that phase 2 REGRESSED local: the studio began dispatching image
// generation to a module that existed only as a Cloudflare Worker, so on this host the picker filled
// and every generation 502'd. These tests pin the capability back, over the module's real app.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createChainModuleApp } from "../src/modules/chain/app.js";
import { invokeImageGenerate, MODELS } from "../src/modules/chain/image-generate-core.js";
import { checkHookOutput } from "@skyphusion-labs/vivijure-core/modules/conformance";

// 1x1 PNG so assertions run against real image bytes, not a placeholder string.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const GATEWAY_ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  GATEWAY_ID: "vivijure",
  CF_AIG_TOKEN: "aig",
  CLOUDFLARE_API_TOKEN: "cft",
};

/** Stub the AI gateway HTTP call that aiRun makes, and record what was sent. */
function stubAi(reply: unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      // the generated-image fetch for proxied models
      if (url.startsWith("https://images.example/")) {
        return new Response(Buffer.from(PNG_B64, "base64"), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      let body: unknown = null;
      try { body = JSON.parse(String(init?.body ?? "null")); } catch { body = init?.body ?? null; }
      calls.push({ url, body });
      return new Response(JSON.stringify(reply), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("image.generate declares a runnable model set", () => {
  it("declares models, and the default is one of them", () => {
    expect(MODELS.length).toBeGreaterThan(0);
    expect(MODELS).toContain(MODELS[0]);
  });

  // Parity-absolute: a model either host cannot run is a lie in the shared picker.
  it("declares the SAME set as the cf module", () => {
    // Mirrors modules/image-generate/src/index.ts in vivijure-cf. Kept as a literal rather than an
    // import because the two repos do not share code -- which is exactly why it can drift.
    expect([...MODELS].sort()).toEqual([
      "@cf/black-forest-labs/flux-1-schnell",
      "@cf/black-forest-labs/flux-2-dev",
      "@cf/black-forest-labs/flux-2-klein-4b",
      "@cf/black-forest-labs/flux-2-klein-9b",
      "@cf/leonardo/lucid-origin",
      "@cf/leonardo/phoenix-1.0",
      "@cf/lykon/dreamshaper-8-lcm",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
      "google/nano-banana-pro",
      "openai/gpt-image-1.5",
      "recraft/recraftv4",
    ]);
  });
});

describe("image.generate invoke", () => {
  it("returns a CONFORMANT payload the core accepts", async () => {
    stubAi({ image: PNG_B64 });
    const r = await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "a quiet harbor at dawn" },
      config: { model: "@cf/stabilityai/stable-diffusion-xl-base-1.0" },
      context: { project: "test", job_id: "j1" },
    });
    expect(r.ok).toBe(true);
    // THE gate: the core's own conformance checker must accept this payload.
    expect(checkHookOutput("image.generate", (r as { output: unknown }).output).pass).toBe(true);
  });

  it("returns real image bytes with a sniffed mime that matches them", async () => {
    stubAi({ image: PNG_B64 });
    const r = (await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x" },
      config: { model: "@cf/lykon/dreamshaper-8-lcm" },
      context: { project: "test", job_id: "j1" },
    })) as { ok: true; output: { image: { bytes_b64: string; mime: string } } };
    expect(r.output.image.mime).toBe("image/png");
    expect(r.output.image.bytes_b64).toBe(PNG_B64);
    expect(r.output.image.bytes_b64.startsWith("data:")).toBe(false);
  });

  // The quirks below were each learned from a real failure; sending the wrong step key is silently
  // ignored upstream, which reads as success and produces a worse image.
  it("sends SDXL num_steps, and schnell 4 steps with no negative prompt", async () => {
    const calls = stubAi({ image: PNG_B64 });
    await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x", negative_prompt: "blurry" },
      config: { model: "@cf/stabilityai/stable-diffusion-xl-base-1.0" },
      context: { project: "test", job_id: "j1" },
    });
    await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x", negative_prompt: "blurry" },
      config: { model: "@cf/black-forest-labs/flux-1-schnell" },
      context: { project: "test", job_id: "j1" },
    });
    // aiRun posts params flat on the per-model /ai/run/{model} path (see platform/ai-run.ts).
    const aiCalls = calls.filter((c) => c.url.includes("/ai/run/"));
    const sdxl = aiCalls[0].body as Record<string, unknown>;
    const schnell = aiCalls[1].body as Record<string, unknown>;
    expect(sdxl.num_steps).toBe(20);
    expect(sdxl.steps).toBeUndefined();
    expect(schnell.steps).toBe(4);
    expect(schnell.negative_prompt).toBeUndefined();
  });

  it("clamps an unknown model to the declared default instead of passing it upstream", async () => {
    const calls = stubAi({ image: PNG_B64 });
    const r = await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x" },
      config: { model: "acme/not-a-real-model" },
      context: { project: "test", job_id: "j1" },
    });
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("acme/not-a-real-model"))).toBe(false);
  });

  it("FAILS LOUD, naming the model, when the model returns no image", async () => {
    stubAi({});
    const r = await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x" },
      config: { model: "@cf/lykon/dreamshaper-8-lcm" },
      context: { project: "test", job_id: "j1" },
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("@cf/lykon/dreamshaper-8-lcm");
  });

  it("FAILS LOUD when the provider refuses the generation", async () => {
    stubAi({ error: "content policy" });
    const r = await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "x" },
      config: { model: "@cf/lykon/dreamshaper-8-lcm" },
      context: { project: "test", job_id: "j1" },
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("content policy");
  });

  it("rejects an empty prompt rather than generating something arbitrary", async () => {
    stubAi({ image: PNG_B64 });
    const r = await invokeImageGenerate(GATEWAY_ENV, {
      hook: "image.generate",
      input: { prompt: "   " },
      config: {},
      context: { project: "test", job_id: "j1" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("image.generate over the module app (the real transport)", () => {
  function app() {
    return createChainModuleApp(
      { name: "image-generate", version: "0.1.0", api: "vivijure-module/2", hooks: ["image.generate"] },
      "image-generate",
      async () => ({ env: GATEWAY_ENV as never, store: {} as never }),
    );
  }

  it("serves /invoke for its hook", async () => {
    stubAi({ image: PNG_B64 });
    const res = await app().request("/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook: "image.generate", input: { prompt: "harbor" }, config: {} }),
    });
    const body = (await res.json()) as { ok: boolean; output?: unknown };
    expect(body.ok).toBe(true);
    expect(checkHookOutput("image.generate", body.output).pass).toBe(true);
  });

  it("refuses a hook it does not serve", async () => {
    stubAi({ image: PNG_B64 });
    const res = await app().request("/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook: "plan.enhance", input: {}, config: {} }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("plan.enhance");
  });
});
