// Image-gen helpers (ported from vivijure/modules/cast-image/src/image-gen.ts + proxied-image-params).

import type { Provider } from "./models.js";

export function isFlux2(model: string): boolean {
  return model.startsWith("@cf/black-forest-labs/flux-2-");
}

export function sniffImageMime(bytes: ArrayBuffer | Uint8Array): { mime: string; ext: string } {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/png", ext: "png" };
}

export function proxiedParams(model: string, prompt: string, imageInputs: string[] = []): Record<string, unknown> {
  if (model.startsWith("google/")) {
    const p: Record<string, unknown> = { prompt, output_format: "png" };
    if (imageInputs.length) p.image_input = imageInputs.slice(0, 3);
    return p;
  }
  if (model.startsWith("openai/")) {
    const p: Record<string, unknown> = { prompt, quality: "high", size: "1024x1024" };
    if (imageInputs.length) p.images = imageInputs.slice(0, 16);
    return p;
  }
  if (model.startsWith("recraft/")) return { prompt, size: "1024x1024", style: "digital_illustration" };
  return { prompt };
}

export function buildProxiedImageParams(provider: Provider | undefined, prompt: string): Record<string, unknown> {
  switch (provider) {
    case "google":
      return { prompt, output_format: "png" };
    case "openai":
      return { prompt, quality: "high", size: "1024x1024" };
    case "recraft":
      return { prompt, size: "1024x1024", style: "digital_illustration" };
    default:
      return { prompt };
  }
}
