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

/** RunPod body for the dedicated vivijure-musetalk endpoint (R2 mode).
 *
 *  `output_key`: the film's own key when core sends one (core#385: every suffix step writes under
 *  `renders/<project>/clips/<film>/`), so two films of one project never write the same `_ls` clip
 *  (local#529). The shared `<clip>_ls` key is only the fallback for a core that sends none.
 *  `project`: MuseTalk's R2 mode refuses a body without it ("project is required for R2 mode"), and
 *  scopes both keys to `renders/<project>/`. */
export function buildLipsyncBody(input: FinishInput, cfg: LipsyncConfig, project: string): { input: Record<string, unknown> } {
  return {
    input: {
      project,
      clip_key: input.clip_key,
      audio_key: input.audio_key,
      output_key: input.output_key || lipsyncedKey(input.clip_key),
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
    // local#529: write where core says (the film's own key, core#385); a door with no output_key
    // writes its shared default, which is what two films of one project used to overwrite.
    ...(input.output_key ? { output_key: input.output_key } : {}),
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
  /**
   * Which door served the SUBMIT (local#378). Job ids live in that door's in-process registry, so
   * polling a different door returns 404 and `runpodJobGone` would read a healthy job as missing.
   * Rotation therefore applies to submit only; poll has affinity.
   *
   * OPTIONAL for backward compatibility: `decodeFinishPoll` is permissive, so a token minted before
   * this field existed decodes without it and the poll path falls back to the first door, which is
   * exactly the single-door behaviour those tokens were minted under.
   */
  doorUrl?: string;
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
    // #52: when the backend omits `applied` entirely (a no-op that echoed the input clip), do NOT invent a
    // positive `finish:applied` tag -- that masks a no-op as a real finish. Default to []; a backend that
    // genuinely applied steps returns them, and one that ran nothing honestly reports nothing.
    applied: Array.isArray(inner.applied) ? (inner.applied as string[]) : [],
    // local#307: a RunPod finish worker can soft-degrade (ok:true + a passthrough) exactly like this
    // door's own passthroughOutput() above -- FinishOutput's own `degraded?: string` field already
    // carries that signal. This function used to drop it silently when re-parsing the worker's raw
    // job output, so a genuine soft-degrade reaching the studio via RunPod was indistinguishable from
    // a clean finish by the time platform/modules.ts recorded it. Thread it through unconditionally;
    // absent stays absent (undefined), never invented.
    ...(typeof inner.degraded === "string" && inner.degraded ? { degraded: inner.degraded } : {}),
  };
}
