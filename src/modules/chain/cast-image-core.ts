/**
 * cast.image pure logic (ported from vivijure/modules/cast-image/cast-image.ts).
 */
import type { CastImageOutput } from "@skyphusion-labs/vivijure-core/modules/types";

export const TRAINING_PROMPTS: readonly string[] = [
  "close-up portrait, neutral expression, eye level, soft studio lighting, clean grey background",
  "medium shot, three-quarter angle, looking forward, golden-hour outdoor lighting, blurred natural background",
  "full-body shot, standing pose, hands at sides, even daylight, plain neutral indoor space",
  "profile shot looking left, shoulders-up framing, soft window light from the side, plain wall background",
  "three-quarter shot from slightly above, looking down, warm interior lighting, soft bokeh background",
  "medium close-up, slight smile, looking off to the right, overcast natural daylight, outdoor blurred treeline",
  "close-up portrait, serious expression, looking at camera, dramatic side lighting from the right, dark backdrop",
  "medium shot, dynamic mid-action pose, looking forward, harsh midday sunlight, plain background",
  "three-quarter shot, sitting on a stool, looking thoughtfully to the side, warm indoor lamp lighting, plain dark background",
  "close-up portrait, slight head tilt, looking up at the camera, soft natural window light, plain background",
];

export const FLAG_FALLBACK_MODEL = "google/nano-banana-pro";

export const MODELS = [
  "@cf/black-forest-labs/flux-2-klein-9b",
  "google/nano-banana-pro",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-dev",
] as const;

export function composeTrainingPrompt(template: string, bible?: string, style?: string): string {
  const safeStyle = String(style || "").trim();
  const lead = safeStyle ? `${safeStyle} art style, ${safeStyle} illustration. ` : "";
  const safeBible = String(bible || "").trim();
  if (!safeBible) return lead + template;
  const trimmed = safeBible.length > 600 ? safeBible.slice(0, 600) : safeBible;
  return `${lead}${template}. ${trimmed}`;
}

export function clampNumImages(n: unknown): number {
  const v = Math.round(Number(n) || 10);
  return Math.max(4, Math.min(TRAINING_PROMPTS.length, v));
}

export function refKey(castId: number, index: number, ext: string): string {
  const safeExt = /^(png|jpg|jpeg|webp)$/i.test(String(ext)) ? ext.toLowerCase() : "png";
  return `cast-gen/${castId}/ref_${String(index).padStart(2, "0")}.${safeExt}`;
}

export interface CastImageState {
  cast_id: number;
  model: string;
  fallback_used: boolean;
  prompts: string[];
  done: { key: string; mime: string }[];
  total: number;
  ref_urls: string[];
}

export interface PollToken {
  cast_id: number;
  job_id: string;
}

export function encodePoll(t: PollToken): string {
  return Buffer.from(JSON.stringify(t)).toString("base64");
}

export function decodePoll(token: string): PollToken | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as PollToken;
    if (o && typeof o.cast_id === "number" && typeof o.job_id === "string") return o;
  } catch {
    /* fall through */
  }
  return null;
}

export function stateKey(castId: number, jobId: string): string {
  return `cast-gen/${castId}/${jobId}.state.json`;
}

export function buildState(
  input: { cast_id: number; portrait_url: string; source_urls?: string[]; bible?: string; art_style?: string },
  model: string,
  num: number,
): CastImageState {
  const n = clampNumImages(num);
  const prompts = TRAINING_PROMPTS.slice(0, n).map((t) => composeTrainingPrompt(t, input.bible, input.art_style));
  const ref_urls = [input.portrait_url, ...(input.source_urls || [])].filter(Boolean);
  return { cast_id: input.cast_id, model, fallback_used: false, prompts, done: [], total: n, ref_urls };
}

export function readOutput(state: CastImageState): CastImageOutput {
  return {
    cast_id: state.cast_id,
    images: state.done,
    applied: [
      `model:${state.model}${state.fallback_used ? "+nano-banana-fallback" : ""}`,
      `generated:${state.done.length}`,
    ],
  };
}
