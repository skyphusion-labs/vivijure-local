import type { FinishInput, FinishOutput } from "@skyphusion-labs/vivijure-core";

export function passthroughOutput(
  input: FinishInput,
  reason: string,
  opts: { degraded?: boolean; detail?: string } = {},
): FinishOutput {
  const degraded = opts.degraded ?? true;
  const out: FinishOutput = {
    shot_id: input.shot_id,
    clip_key: input.clip_key,
    out_fps: input.src_fps ?? 24,
    frames: input.frames ?? 0,
    applied: [`${degraded ? "passthrough" : "noop"}:${reason}`],
  };
  if (degraded) out.degraded = opts.detail ? `${reason}: ${opts.detail}` : reason;
  return out;
}

export interface FinishConfig {
  interpolate: boolean;
  interpolation_factor: number;
  face_restore: string;
  face_fidelity: number;
  only_faces: boolean;
}

export function coerceFinishConfig(cfg: Record<string, unknown>): FinishConfig {
  const factor = Number(cfg.interpolation_factor ?? 2);
  const snapped = [8, 4, 2, 1].find((v) => v <= factor) ?? 1;
  return {
    interpolate: typeof cfg.interpolate === "boolean" ? cfg.interpolate : true,
    interpolation_factor: snapped,
    face_restore: ["none", "gfpgan", "codeformer"].includes(String(cfg.face_restore))
      ? String(cfg.face_restore)
      : "none",
    face_fidelity: Math.min(1, Math.max(0, Number(cfg.face_fidelity ?? 0.7))),
    only_faces: typeof cfg.only_faces === "boolean" ? cfg.only_faces : true,
  };
}

export interface LipsyncConfig {
  version: string;
  bbox_shift: number;
}

const LIPSYNC_VERSIONS = ["v15", "v1"] as const;

export function coerceLipsyncConfig(cfg: Record<string, unknown>): LipsyncConfig {
  return {
    version: (LIPSYNC_VERSIONS as readonly string[]).includes(String(cfg.version)) ? String(cfg.version) : "v15",
    bbox_shift: Number.isFinite(Number(cfg.bbox_shift)) ? Math.trunc(Number(cfg.bbox_shift)) : 0,
  };
}

export function lipsyncedKey(clipKey: string): string {
  const dot = clipKey.lastIndexOf(".");
  return dot > clipKey.lastIndexOf("/") ? `${clipKey.slice(0, dot)}_ls${clipKey.slice(dot)}` : `${clipKey}_ls`;
}

/** RunPod body for the dedicated vivijure-musetalk endpoint (R2 mode). */
export function buildLipsyncBody(input: FinishInput, cfg: LipsyncConfig): { input: Record<string, unknown> } {
  return {
    input: {
      clip_key: input.clip_key,
      audio_key: input.audio_key,
      output_key: lipsyncedKey(input.clip_key),
      version: cfg.version,
      bbox_shift: cfg.bbox_shift,
      ...(input.output_hash ? { output_hash: input.output_hash } : {}),
    },
  };
}

export function buildFinishBody(
  input: FinishInput,
  cfg: FinishConfig,
  project: string,
  action: "finish_clip" | "lipsync_clip" | "upscale_clip",
  extra?: Record<string, unknown>,
): { input: Record<string, unknown> } {
  const base: Record<string, unknown> = {
    action,
    project,
    shot_id: input.shot_id,
    clip_key: input.clip_key,
    ...(input.output_hash ? { output_hash: input.output_hash } : {}),
    ...extra,
  };
  if (action === "finish_clip") {
    base.config = {
      interpolate: cfg.interpolate,
      interpolation_factor: cfg.interpolation_factor,
      face_restore: cfg.face_restore === "none" ? false : cfg.face_restore,
      face_fidelity: cfg.face_fidelity,
      only_faces: cfg.only_faces,
    };
  }
  return { input: base };
}

export interface FinishPollState {
  jobId: string;
  shotId: string;
  clipKey?: string;
  srcFps: number;
  frames: number;
  submittedAt?: number;
}

export function encodeFinishPoll(s: FinishPollState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

export function decodeFinishPoll(token: string): FinishPollState | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as FinishPollState;
    if (o && typeof o.jobId === "string" && typeof o.shotId === "string") return o;
  } catch {
    /* bad token */
  }
  return null;
}

export function parseFinishOutput(shotId: string, output: unknown, srcFps: number, frames: number): FinishOutput | null {
  const root = (output && typeof output === "object" ? output : null) as Record<string, unknown> | null;
  const inner =
    root && root.output && typeof root.output === "object"
      ? (root.output as Record<string, unknown>)
      : root;
  if (!inner) return null;
  const clip_key = typeof inner.clip_key === "string" ? inner.clip_key : null;
  if (!clip_key) return null;
  return {
    shot_id: typeof inner.shot_id === "string" ? inner.shot_id : shotId,
    clip_key,
    out_fps: typeof inner.out_fps === "number" ? inner.out_fps : srcFps,
    frames: typeof inner.frames === "number" ? inner.frames : frames,
    applied: Array.isArray(inner.applied)
      ? (inner.applied as string[])
      : ["finish:applied"],
  };
}
