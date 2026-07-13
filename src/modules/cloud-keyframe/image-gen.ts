/**
 * Reference-conditioned keyframe image gen (ported from vivijure/modules/cloud-keyframe/src/image-gen.ts).
 */
import { aiRun } from "../../platform/ai-run.js";
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { extractProxiedImageUrl } from "../../output-extract.js";
import { isFlux2, sniffImageMime } from "../../chat-image-gen.js";
import { base64ToBytes, bytesToBase64 } from "../../utils.js";

const FLUX2_MAX_REFS = 4;
const PROXIED_MAX_REFS = 3;

const SUPPORTED_RATIOS: { label: string; value: number }[] = [
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
];

export function nearestAspectRatio(width: number, height: number): string {
  const r = width > 0 && height > 0 ? width / height : 1;
  let best = SUPPORTED_RATIOS[0];
  let bestDiff = Infinity;
  for (const cand of SUPPORTED_RATIOS) {
    const diff = Math.abs(cand.value - r);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cand;
    }
  }
  return best.label;
}

function proxiedParams(
  model: string,
  prompt: string,
  imageInputs: string[],
  width: number,
  height: number,
): Record<string, unknown> {
  if (model.startsWith("google/")) {
    const p: Record<string, unknown> = {
      prompt,
      output_format: "png",
      aspect_ratio: nearestAspectRatio(width, height),
    };
    if (imageInputs.length) p.image_input = imageInputs.slice(0, PROXIED_MAX_REFS);
    return p;
  }
  if (model.startsWith("openai/")) {
    const p: Record<string, unknown> = { prompt, quality: "high", size: `${width}x${height}` };
    if (imageInputs.length) p.images = imageInputs.slice(0, 16);
    return p;
  }
  return { prompt };
}

export async function generateCloudKeyframeImage(
  env: AiGatewayEnv,
  model: string,
  prompt: string,
  refBlobs: Blob[],
  width: number,
  height: number,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (isFlux2(model)) {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", String(width));
    form.append("height", String(height));
    let i = 0;
    for (const blob of refBlobs) {
      if (i >= FLUX2_MAX_REFS) break;
      form.append(`input_image_${i}`, blob, `ref-${i}.png`);
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

  const cap = model.startsWith("openai/") ? 16 : PROXIED_MAX_REFS;
  const imageInputs: string[] = [];
  for (const blob of refBlobs) {
    if (imageInputs.length >= cap) break;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    imageInputs.push(`data:image/png;base64,${bytesToBase64(bytes)}`);
  }
  const result = await aiRun(env, model, proxiedParams(model, prompt, imageInputs, width, height));
  const url = extractProxiedImageUrl(result);
  if (!url) throw new Error("proxied image model returned no url");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch proxied image -> ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, mime: resp.headers.get("content-type") || "image/png" };
}
