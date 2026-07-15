import type { DurationGridDecl, MotionBackendInput, MotionBackendOutput } from "@skyphusion-labs/vivijure-core";

export function readDurationGrid(raw: unknown): DurationGridDecl | null {
  const g = raw as { fps?: unknown; tiers?: unknown } | null | undefined;
  if (!g || typeof g.fps !== "number" || !(g.fps > 0) || !g.tiers || typeof g.tiers !== "object") return null;
  const tiers: Record<string, { max_frames: number }> = {};
  for (const [tier, v] of Object.entries(g.tiers as Record<string, { max_frames?: unknown } | null>)) {
    if (v && typeof v.max_frames === "number" && v.max_frames > 0) tiers[tier] = { max_frames: v.max_frames };
  }
  return Object.keys(tiers).length > 0 ? { fps: g.fps, tiers } : null;
}

export const DEFAULT_FPS = 24;

export function framesFor(seconds: number, fps: number): number {
  const n = Math.round((Number(seconds) || 5) * fps);
  return Math.max(fps, n);
}

export function buildI2vBody(
  input: MotionBackendInput,
  cfg: Record<string, unknown>,
  project: string,
  durationGrid: DurationGridDecl | null = null,
): { input: Record<string, unknown> } {
  const quality = String(cfg.quality ?? "standard");
  const fixedTier = durationGrid?.tiers[quality];
  // Fixed-grid doors own generation cadence. CogVideoX-5B-I2V can report COMPLETED for off-grid
  // frame counts while decoding only latent tile noise, so use its declared tier count verbatim.
  // Flexible doors omit duration_grid and retain the existing seconds * fps behavior.
  const fps = fixedTier ? durationGrid.fps : (typeof cfg.fps === "number" ? cfg.fps : DEFAULT_FPS);
  const config: Record<string, unknown> = {
    quality,
    num_frames: fixedTier ? fixedTier.max_frames : framesFor(input.seconds ?? 5, fps),
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

export function readOutput(shotId: string, output: unknown): MotionBackendOutput | null {
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

export interface PollState {
  jobId: string;
  project: string;
  shotId: string;
  submittedAt?: number;
}

export const JOB_NOTFOUND_GRACE_MS = 150_000;

export function encodePoll(s: PollState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

export function decodePoll(token: string): PollState | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as PollState;
    if (o && typeof o.jobId === "string" && typeof o.project === "string" && typeof o.shotId === "string") {
      return o;
    }
  } catch {
    /* bad token */
  }
  return null;
}

export function jobGone(httpStatus: number, body: { status?: unknown; title?: unknown } | null): boolean {
  if (httpStatus === 404) return true;
  if (!body) return false;
  const st = body.status;
  if (typeof st === "string" && st.length > 0) return false;
  if (typeof st === "number") return st === 404;
  return typeof body.title === "string" && /not\s*found/i.test(body.title);
}

export function classifyGoneState(
  submittedAt: number | undefined,
  now: number,
  graceMs: number = JOB_NOTFOUND_GRACE_MS,
): "gone-failed" | "gone-grace" {
  if (submittedAt === undefined) return "gone-failed";
  return now - submittedAt >= graceMs ? "gone-failed" : "gone-grace";
}
