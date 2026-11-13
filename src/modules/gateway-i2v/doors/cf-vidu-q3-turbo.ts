// cf-vidu-q3-turbo: VENDORED from vivijure-cf for local#568. Replaces the local RunPod `vidu-q3` door.
//
// Source of truth (keep in step; the parity test compares against the pinned vivijure-cf checkout):
//   modules/cf-vidu-q3-turbo/src/params.ts  (blob 16955579936f403d3a4dd08f6ef08af163f63d78)
//   modules/cf-vidu-q3-turbo/src/index.ts   (blob 8021b61eb4bff8a768a415ede885b553e390b64c, error strings)
// at vivijure-cf main 2451d88, the same blobs as dev/cf-quality-tier-pin af2110e.
// The manifest is NOT vendored here: dev/manifests/cf-vidu-q3-turbo.json is synced from cf.
//
// Model: vidu/q3-turbo via the Cloudflare AI Gateway.
// schema-input.json (developers.cloudflare.com/ai/models/vidu/q3-turbo), read by cf 2026-10-30:
//   required: duration (integer 1-16, default 5), resolution (540p|720p|1080p, default 720p)
//   prompt: string, maxLength 5000, not required
//   start_image: string, optional. Use alone for image-to-video, or with end_image.
//   end_image: string, optional. Must be used together with start_image.
//   audio: boolean. The page says default true for Q3; the JSON schema has no default.
//   aspect_ratio: text-to-video only. Not sent: this door always sends start_image.
//   additionalProperties: false
// schema-output.json: required video URI. No fps, no duration.
import type { MotionBackendInput } from "@skyphusion-labs/vivijure-core/modules/types";
import type { GatewayI2vDoor } from "../door.js";

export const MODEL = "vidu/q3-turbo";
/** schema-output.json does not state a frame rate. 24 is the stamp the other Cloudflare motion doors
 *  use, so frames/fps equals the seconds sent. fps is not sent: not a schema property. */
export const OUT_FPS = 24;
export const MIN_DURATION = 1;
export const MAX_DURATION = 16;
export const DEFAULT_DURATION = 5;
export const PROMPT_MAX = 5000;
export const RESOLUTIONS = ["540p", "720p", "1080p"] as const;
export const DEFAULT_RESOLUTION = "720p";

export type ModuleConfig = {
  resolution: (typeof RESOLUTIONS)[number];
  generate_audio: boolean;
};

export function clampDuration(seconds: number): number {
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n)) return DEFAULT_DURATION;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, n));
}

export function normalizeConfig(raw: Record<string, unknown>): ModuleConfig {
  const res = String(raw.resolution ?? DEFAULT_RESOLUTION);
  return {
    resolution: (RESOLUTIONS as readonly string[]).includes(res)
      ? (res as ModuleConfig["resolution"])
      : DEFAULT_RESOLUTION,
    generate_audio: raw.generate_audio !== false,
  };
}

export function buildParams(input: MotionBackendInput, config: ModuleConfig): Record<string, unknown> {
  const prompt = (input.prompt || "").slice(0, PROMPT_MAX);
  const params: Record<string, unknown> = {
    prompt,
    start_image: input.keyframe_url,
    duration: clampDuration(input.seconds),
    resolution: config.resolution,
    // Sent explicitly. The JSON schema does not declare a default; the page prose says Q3 defaults
    // audio to true.
    audio: config.generate_audio,
  };
  if (input.last_keyframe_url) params.end_image = input.last_keyframe_url;
  return params;
}

export function parseVideoUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.state === "string" && r.state.length > 0 && r.state !== "Completed") return null;
  if (typeof r.video === "string" && r.video.length > 0) return r.video;
  const inner = r.result;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const v = (inner as Record<string, unknown>).video;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function stateKey(jobId: string): string { return `cf-vidu-q3-turbo/${jobId}.state.json`; }
export function clipKey(project: string, shotId: string): string {
  const safe = (s: string) => (s || "x").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `renders/${safe(project)}/clips/${safe(shotId)}_cf-vidu-q3-turbo.mp4`;
}

export const door: GatewayI2vDoor<ModuleConfig> = {
  name: "cf-vidu-q3-turbo",
  model: MODEL,
  outFps: OUT_FPS,
  clampDuration,
  normalizeConfig,
  buildParams,
  parseVideoUrl,
  hasAudio: (config) => config.generate_audio === true,
  stateKey,
  clipKey,
};
