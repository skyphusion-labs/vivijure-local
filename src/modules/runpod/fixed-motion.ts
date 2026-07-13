/**
 * RunPod motion.backend modules with fixed endpoint URLs (seedance, kling, ...).
 */

import type {
  InvokeRequest,
  InvokeResponse,
  MotionBackendInput,
  MotionBackendOutput,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core/modules/types";
import type { RunpodModuleEnv } from "./env.js";
import {
  authHeader,
  classifyGoneState,
  decodePoll,
  encodePoll,
  runpodBase,
  runpodJobGone,
  runpodTerminalFailure,
  terminalErrorInOutput,
} from "./shared.js";
import { putClipBytes } from "./storage.js";

export interface FixedEndpointConfig {
  endpoint: string;
  clipSuffix: string;
  buildBody: (input: MotionBackendInput, cfg: Record<string, unknown>) => Record<string, unknown>;
  outFps?: number;
}

export const FIXED_MOTION: Record<string, FixedEndpointConfig> = {
  seedance: {
    endpoint: "https://api.runpod.ai/v2/seedance-v1-5-pro-i2v",
    clipSuffix: "_seedance",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      duration: Math.max(4, Math.min(12, Math.round(Number(input.seconds) || 5))),
      aspect_ratio: String(cfg.aspect_ratio ?? "16:9"),
      resolution: String(cfg.resolution ?? "720p"),
      camera_fixed: !!cfg.camera_fixed,
      generate_audio: !!cfg.generate_audio,
      seed: typeof cfg.seed === "number" ? cfg.seed : -1,
    }),
    outFps: 24,
  },
  kling: {
    endpoint: "https://api.runpod.ai/v2/kling-v2-1-i2v-pro",
    clipSuffix: "_kling",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      duration: String(cfg.duration ?? "5"),
      aspect_ratio: String(cfg.aspect_ratio ?? "16:9"),
      mode: String(cfg.mode ?? "pro"),
    }),
  },
  "google-veo": {
    endpoint: "https://api.runpod.ai/v2/google-veo3-1-fast-i2v",
    clipSuffix: "_veo",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      aspect_ratio: String(cfg.aspect_ratio ?? "16:9"),
      resolution: String(cfg.resolution ?? "720p"),
    }),
  },
  "minimax-hailuo": {
    endpoint: "https://api.runpod.ai/v2/minimax-hailuo-2-3-fast",
    clipSuffix: "_hailuo",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      duration: Math.max(4, Math.min(10, Math.round(Number(input.seconds) || 5))),
    }),
  },
  "vidu-q3": {
    endpoint: "https://api.runpod.ai/v2/vidu-q3-i2v",
    clipSuffix: "_vidu",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      duration: Math.max(4, Math.min(8, Math.round(Number(input.seconds) || 5))),
      resolution: String(cfg.resolution ?? "720p"),
    }),
  },
  "alibaba-wan": {
    endpoint: "https://api.runpod.ai/v2/wan-2-6-i2v",
    clipSuffix: "_wan",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      negative_prompt: "",
      size: String(cfg.resolution ?? cfg.size ?? "720p"),
      duration: clampWanDuration(Number(input.seconds) || 5),
      shot_type: String(cfg.shot_type ?? "single"),
      seed: -1,
      enable_prompt_expansion: cfg.enable_prompt_expansion === true,
      enable_safety_checker: true,
    }),
  },
  "alibaba-wan-lora": {
    endpoint: "https://api.runpod.ai/v2/wan-2-2-t2v-720-lora",
    clipSuffix: "_wanlora",
    buildBody: (input, cfg) => ({
      prompt: input.prompt,
      image: input.keyframe_url,
      lora_key: cfg.lora_key,
      duration: Math.max(4, Math.min(10, Math.round(Number(input.seconds) || 5))),
    }),
  },
};

const WAN_DURATIONS = [5, 10, 15] as const;

function clampWanDuration(seconds: number): number {
  const n = Math.round(Number(seconds) || 5);
  return WAN_DURATIONS.find((d) => d >= n) ?? WAN_DURATIONS[WAN_DURATIONS.length - 1];
}

function clipKey(project: string, shotId: string, suffix: string): string {
  const safe = (s: string) => (s || "x").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `renders/${safe(project)}/clips/${safe(shotId)}${suffix}.mp4`;
}

const VIDEO_URL_RE = /^https?:\/\/\S+\.(mp4|mov|webm|m4v)(\?|$)/i;
const ANY_URL_RE = /^https?:\/\//i;

export function extractVideoUrl(output: unknown): string | null {
  const findFirst = (v: unknown, re: RegExp): string | null => {
    if (typeof v === "string") return re.test(v) ? v : null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const hit = findFirst(x, re);
        if (hit) return hit;
      }
      return null;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) {
        const hit = findFirst(x, re);
        if (hit) return hit;
      }
    }
    return null;
  };
  // #51: prefer a URL that is actually a video ANYWHERE in the payload; only if none exists fall back to the
  // first http(s) URL. The old single pass returned the first http(s) URL it hit, so a thumbnail / poster /
  // preview / log URL appearing before the real clip in key order was downloaded and stored as the shot's
  // .mp4 (wrong content shipped as success). The fallback still handles a provider that returns an
  // extension-less video URL (no video-typed URL present -> fall back), but a real video URL always wins.
  return findFirst(output, VIDEO_URL_RE) ?? findFirst(output, ANY_URL_RE);
}

export async function invokeFixedMotion(
  env: RunpodModuleEnv,
  name: string,
  req: InvokeRequest<MotionBackendInput>,
): Promise<InvokeResponse<MotionBackendOutput>> {
  const cfg = FIXED_MOTION[name];
  if (!cfg) return { ok: false, error: `${name}: not a fixed-endpoint motion module` };
  const apiKey = env.RUNPOD_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: `${name}: RUNPOD_API_KEY not configured` };
  const input = req.input;
  if (!input?.prompt || !input.shot_id) {
    return { ok: false, error: "motion.backend: input needs shot_id and prompt" };
  }
  const base = runpodBase(cfg.endpoint);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ input: cfg.buildBody(input, req.config ?? {}) }),
    });
    if (!r.ok) return { ok: false, error: `${name} /run -> ${r.status}` };
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: false, error: `${name} /run returned no job id` };
    return {
      ok: true,
      pending: true,
      poll: encodePoll({
        jobId,
        project: req.context.project,
        shotId: input.shot_id,
        seconds: input.seconds,
        submittedAt: Date.now(),
        extra: { module: name },
      }),
    };
  } catch (e) {
    return { ok: false, error: `${name} submit failed: ${(e as Error).message}` };
  }
}

export async function pollFixedMotion(
  env: RunpodModuleEnv,
  name: string,
  body: PollRequest,
): Promise<PollResponse<MotionBackendOutput>> {
  const cfg = FIXED_MOTION[name];
  if (!cfg) return { ok: false, error: `${name}: not a fixed-endpoint motion module` };
  const apiKey = env.RUNPOD_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: `${name}: RUNPOD_API_KEY not configured` };
  const st = decodePoll(body.poll);
  if (!st) return { ok: false, error: `${name}: bad poll token` };
  const base = runpodBase(cfg.endpoint);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(apiKey) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: `${name} job not found (shot ${st.shotId})` };
    }
    return { ok: true, pending: true };
  }
  const term = terminalErrorInOutput(s.output) ?? (typeof s.error === "string" ? s.error : null);
  if (term) return { ok: false, error: term };
  const failed = runpodTerminalFailure(name, s); // #47: TIMED_OUT/CANCELLED/crashed-worker FAILED
  if (failed) return failed;
  if (s.status !== "COMPLETED") return { ok: true, pending: true };

  const videoUrl = extractVideoUrl(s.output);
  if (!videoUrl) return { ok: false, error: `${name} completed but returned no video URL` };
  const clip_key = clipKey(st.project, st.shotId, cfg.clipSuffix);
  try {
    const vid = await fetch(videoUrl);
    if (!vid.ok) return { ok: false, error: `${name} video download -> ${vid.status}` };
    await putClipBytes(env, clip_key, new Uint8Array(await vid.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: `${name} store failed: ${(e as Error).message}` };
  }
  return {
    ok: true,
    output: {
      shot_id: st.shotId,
      clip_key,
      fps: cfg.outFps ?? 16,
      frames: Math.round((st.seconds ?? 5) * (cfg.outFps ?? 16)),
    },
  };
}
