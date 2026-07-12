import type { MotionBackendInput, MotionBackendOutput } from "@skyphusion-labs/vivijure-core";

export const DEFAULT_FPS = 16;

export function framesFor(seconds: number, fps: number): number {
  const n = Math.round((Number(seconds) || 5) * fps);
  return Math.max(fps, n);
}

export function buildI2vBody(
  input: MotionBackendInput,
  cfg: Record<string, unknown>,
  project: string,
): { input: Record<string, unknown> } {
  const fps = typeof cfg.fps === "number" ? cfg.fps : DEFAULT_FPS;
  const config: Record<string, unknown> = {
    quality: String(cfg.quality ?? "standard"),
    num_frames: framesFor(input.seconds ?? 5, fps),
    fps,
  };
  if (typeof cfg.seed === "number" && cfg.seed >= 0) config.seed = cfg.seed;
  if (typeof cfg.flow_shift === "number") config.flow_shift = cfg.flow_shift;
  if (typeof cfg.negative_prompt === "string" && cfg.negative_prompt) {
    config.negative_prompt = cfg.negative_prompt;
  }
  const job: Record<string, unknown> = {
    action: "i2v_clip",
    project,
    shot_id: input.shot_id,
    prompt: input.prompt,
    config,
  };
  if (input.keyframe_key) job.keyframe_key = input.keyframe_key;
  return { input: job };
}

export interface BackendI2vOutput {
  clip_key?: string;
  shot_id?: string;
  fps?: number;
  num_frames?: number;
  distilled?: boolean;
}

export function readI2vOutput(shotId: string, output: unknown): MotionBackendOutput | null {
  const out = (output ?? {}) as BackendI2vOutput;
  if (!out.clip_key) return null;
  const mapped: MotionBackendOutput = {
    shot_id: out.shot_id || shotId,
    clip_key: out.clip_key,
    fps: typeof out.fps === "number" ? out.fps : DEFAULT_FPS,
    frames: typeof out.num_frames === "number" ? out.num_frames : 0,
  };
  if (typeof out.distilled === "boolean") mapped.distilled = out.distilled;
  return mapped;
}

export interface I2vPollState {
  jobId: string;
  project: string;
  shotId: string;
  submittedAt?: number;
}

export function encodeI2vPoll(s: I2vPollState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

export function decodeI2vPoll(token: string): I2vPollState | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as I2vPollState;
    if (o && typeof o.jobId === "string" && typeof o.project === "string" && typeof o.shotId === "string") {
      return o;
    }
  } catch {
    /* bad token */
  }
  return null;
}
