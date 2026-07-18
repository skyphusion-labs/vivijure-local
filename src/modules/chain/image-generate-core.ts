// The image.generate hook, in-process for the local host (cf#129).
//
// WHY THIS EXISTS: cf#129 phase 2 moved image generation out of the studio and behind an
// image.generate module, so the studio hardcodes no model names. The module written in that phase is
// a Cloudflare Worker, which a local Node host cannot run -- it needs an env.AI binding. The result
// was a REGRESSION on local: the picker filled with models and every generation 502'd, because the
// studio dispatched to a module that did not exist here. Users had chat image generation before
// phase 2 and lost it. This file is local's own declaring module, so the capability comes back and
// the sprint's contract ("dispatch routes to the declaring module") holds on both hosts.
//
// It generates through the SAME AI-gateway path local already uses for cast reference images
// (platform/ai-run aiRun), so this is not a new provider integration -- it is the existing machinery
// behind the hook the studio now speaks.
//
// It returns image BYTES and touches NO storage, matching the cf module exactly. That is the cf#140
// lesson made structural: artifacts were written to one bucket and served from another, so previews
// 404'd in production while every gate stayed green. The CORE owns persistence.

import { aiRun } from "../../platform/ai-run.js";
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { extractProxiedImageUrl } from "../../output-extract.js";
import { base64ToBytes, bytesToBase64 } from "../../utils.js";
import {
  buildProxiedImageParams,
  isFlux2,
  proxiedParams,
  sniffImageMime,
} from "../../chat-image-gen.js";
import type { InvokeRequest, InvokeResponse } from "@skyphusion-labs/vivijure-core";

/** The models this module can actually dispatch. Kept identical to the cf module's list: the two
 *  hosts are parity-absolute, and a row either host cannot run is a lie in the studio picker. */
export const MODELS = [
  "@cf/black-forest-labs/flux-2-klein-9b",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-dev",
  "@cf/black-forest-labs/flux-1-schnell",
  "google/nano-banana-pro",
  "openai/gpt-image-1.5",
  "recraft/recraftv4",
  "@cf/leonardo/lucid-origin",
  "@cf/leonardo/phoenix-1.0",
  "@cf/lykon/dreamshaper-8-lcm",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
];

export interface ImageGenerateInput {
  prompt: string;
  negative_prompt?: string;
  /** Reference images as data: URLs, for multi-reference models. */
  refs?: string[];
  width?: number;
  height?: number;
}

export interface ImageGenerateOutput {
  image: { bytes_b64: string; mime: string };
}

type Provider = "google" | "openai" | "recraft";

function providerOf(model: string): Provider | undefined {
  if (model.startsWith("google/")) return "google";
  if (model.startsWith("openai/")) return "openai";
  if (model.startsWith("recraft/")) return "recraft";
  return undefined;
}

/** Anything a proxied provider returns that means "we refused", so a flagged generation fails loudly
 *  instead of storing an empty object as though it were a picture. */
function detectProviderFailure(result: unknown): string | null {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const err = r.error ?? r.message;
  return typeof err === "string" && err.trim() ? err : null;
}

function dataUrlToBlobParts(dataUrl: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  // Copy into a fresh owned ArrayBuffer: base64ToBytes returns the looser ArrayBufferLike, which
  // Blob rejects under TS 5.7+.
  const src = base64ToBytes(m[2]);
  const owned = new Uint8Array(new ArrayBuffer(src.length));
  owned.set(src);
  return { mime: m[1], bytes: owned };
}

/** Generate ONE image and return raw bytes + the real mime. Throws on any refusal or empty result so
 *  the caller reports an honest error rather than persisting a non-picture. */
export async function generateImageBytes(
  env: AiGatewayEnv,
  args: { model: string; prompt: string; negative_prompt?: string; refs?: string[]; width?: number; height?: number },
): Promise<{ bytes: Uint8Array; mime: string }> {
  const { model } = args;
  const width = args.width ?? 1024;
  const height = args.height ?? 1024;
  const provider = providerOf(model);

  if (provider) {
    const refs = (args.refs ?? []).filter((r) => r.startsWith("data:"));
    const params = refs.length
      ? proxiedParams(model, args.prompt, refs)
      : buildProxiedImageParams(provider, args.prompt);
    const result = await aiRun(env, model, params);
    const failure = detectProviderFailure(result);
    if (failure) throw new Error(`image generation failed: ${failure}`);
    const url = extractProxiedImageUrl(result);
    if (!url) throw new Error("image generation returned no image URL");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`failed to fetch generated image: ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return { bytes, mime: resp.headers.get("content-type") || "image/png" };
  }

  if (isFlux2(model)) {
    // FLUX-2 needs multipart and is gateway-incompatible. FormData does not expose its serialized
    // body/boundary, so wrapping it in a Response yields both.
    const form = new FormData();
    form.append("prompt", args.prompt);
    form.append("width", String(width));
    form.append("height", String(height));
    if (args.negative_prompt?.trim()) form.append("negative_prompt", args.negative_prompt);
    let i = 0;
    for (const ref of args.refs ?? []) {
      if (i >= 4) break;
      const parsed = dataUrlToBlobParts(ref);
      if (!parsed) continue;
      form.append(`input_image_${i}`, new Blob([parsed.bytes], { type: parsed.mime }), `ref-${i}.png`);
      i++;
    }
    const fr = new Response(form);
    const contentType = fr.headers.get("content-type");
    if (!fr.body || !contentType) throw new Error("flux-2 form serialization failed");
    const result = await aiRun(env, model, { multipart: { body: fr.body, contentType } });
    const b64 = (result as { image?: string })?.image;
    if (!b64 || typeof b64 !== "string") throw new Error("flux-2 returned no image");
    const bytes = base64ToBytes(b64);
    return { bytes, mime: sniffImageMime(bytes).mime };
  }

  // Plain @cf text-to-image. The per-model quirks below were each learned from a real failure:
  // schnell is a 4-step distilled model that rejects a negative prompt, and SDXL names its step
  // count differently (sending `steps` is silently ignored, producing a worse image that looks fine).
  const params: Record<string, unknown> = { prompt: args.prompt, width, height, steps: 25 };
  if (args.negative_prompt?.trim()) params.negative_prompt = args.negative_prompt;
  if (model === "@cf/black-forest-labs/flux-1-schnell") {
    params.steps = 4;
    delete params.negative_prompt;
  }
  if (model === "@cf/stabilityai/stable-diffusion-xl-base-1.0") {
    delete params.steps;
    params.num_steps = 20;
  }
  const result = await aiRun(env, model, params);
  const failure = detectProviderFailure(result);
  if (failure) throw new Error(`image generation failed: ${failure}`);

  if (result instanceof ReadableStream) {
    const reader = result.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
    return { bytes, mime: sniffImageMime(bytes).mime };
  }

  const b64 = (result as { image?: string })?.image;
  if (!b64 || typeof b64 !== "string") throw new Error("image generation returned no image");
  const bytes = base64ToBytes(b64);
  return { bytes, mime: sniffImageMime(bytes).mime };
}

/** The image.generate hook entry point. */
export async function invokeImageGenerate(
  env: AiGatewayEnv,
  req: InvokeRequest<ImageGenerateInput>,
): Promise<InvokeResponse<ImageGenerateOutput>> {
  const input = req.input;
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
    return { ok: false, error: "image.generate: input needs a non-empty prompt" };
  }
  // Clamp to a declared model. An unknown id would otherwise reach the binding and surface as an
  // opaque upstream error rather than a studio-level one.
  const requested = req.config?.model;
  const model = typeof requested === "string" && MODELS.includes(requested) ? requested : MODELS[0];

  try {
    const { bytes, mime } = await generateImageBytes(env, {
      model,
      prompt: input.prompt,
      negative_prompt: input.negative_prompt,
      refs: input.refs,
      width: input.width,
      height: input.height,
    });
    if (!bytes.length) return { ok: false, error: `image.generate: ${model} returned zero bytes` };
    return { ok: true, output: { image: { bytes_b64: bytesToBase64(bytes), mime } } };
  } catch (e) {
    // FAIL LOUD: there is no honest passthrough for "make me a picture" and no previous artifact to
    // return, so a failure is reported with the model named, never soft-degraded into a fake success.
    return { ok: false, error: `image.generate: ${model} failed: ${(e as Error).message}` };
  }
}
