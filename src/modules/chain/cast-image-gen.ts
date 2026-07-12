/**
 * cast.image generation (ported from vivijure/modules/cast-image/src/image-gen.ts).
 * FLUX-2: multipart + reference blobs, gateway-bypassed path in ai-run.
 * Proxied (nano-banana): image_input[] data URIs through the gateway.
 */
import { aiRun } from "../../platform/ai-run.js";
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { extractProxiedImageUrl } from "../../output-extract.js";
import { isFlux2, proxiedParams, sniffImageMime } from "../../chat-image-gen.js";
import { base64ToBytes, bytesToBase64 } from "../../utils.js";

const FLUX2_MAX_REFS = 4;

async function fetchRef(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** Generate one training reference image. Throws on no-image / flagged generation. */
export async function generateCastImage(
  env: AiGatewayEnv,
  model: string,
  prompt: string,
  refUrls: string[],
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (isFlux2(model)) {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", "1024");
    form.append("height", "1024");
    let i = 0;
    for (const url of refUrls) {
      if (i >= FLUX2_MAX_REFS) break;
      const blob = await fetchRef(url);
      if (!blob) continue;
      form.append(`input_image_${i}`, blob, `ref-${i}.png`);
      i++;
    }
    const fr = new Response(form);
    const contentType = fr.headers.get("content-type");
    if (!fr.body || !contentType) throw new Error("flux-2 form serialization failed");
    const result = await aiRun(env, model, {
      multipart: { body: fr.body, contentType },
    });
    const b64 = (result as { image?: string })?.image;
    if (!b64 || typeof b64 !== "string") throw new Error("flux-2 returned no image");
    const bytes = base64ToBytes(b64);
    return { bytes, mime: sniffImageMime(bytes).mime };
  }

  const cap = model.startsWith("openai/") ? 16 : 3;
  const imageInputs: string[] = [];
  for (const url of refUrls) {
    if (imageInputs.length >= cap) break;
    const blob = await fetchRef(url);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    imageInputs.push(`data:image/png;base64,${bytesToBase64(bytes)}`);
  }
  const result = await aiRun(env, model, proxiedParams(model, prompt, imageInputs));
  const imageUrl = extractProxiedImageUrl(result);
  if (!imageUrl) throw new Error("proxied image model returned no url");
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`fetch proxied image -> ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, mime: resp.headers.get("content-type") || "image/png" };
}
