// local#568: the generic runner for every hosted (AI Gateway) image-to-video door, written once.
//
// vivijure-cf runs the paid provider call inside a Cloudflare WORKFLOW step, because env.AI.run is
// synchronous and a Worker request cannot hold the minutes a video takes. A Node sidecar CAN hold the
// call, so here it runs as a background task in this process. What has to carry over is the Workflow's
// two guarantees, which cf encodes in modules/_shared/paid-generation.ts:
//   1. never buy a clip twice: the provider call is retried only when it THREW (no success came back),
//      at most twice, and nothing after a successful call ever reaches the provider again;
//      STRICTER than cf (whose step retries every throw): only a failure a retry can fix is retried
//      (network, 5xx, 408, 429; aiRunRetryable). A 4xx (routing, validation, auth) runs exactly once.
//      The first live smoke retried a routing 400 twice for 45 s of backoff (local#568).
//   2. never report a clip that was not stored: the download and write retry on their own, and a final
//      failure reports cf's fixed NOT_STORED_ERROR text (core's classifier reads it as deterministic).
// The store is authoritative for completion (clip present in a `done` state = done), as on cf.
//
// The one thing a Workflow has that a process does not is surviving a restart. cf's poll asks the
// Workflow whether it errored or was terminated. The local stand-in: every `running` state carries the
// process's boot id, and a poll from a DIFFERENT boot fails the job. It is never re-run: the provider
// call may already be billed.
//
// Failures are DATA (ok:false), never thrown across the wire.
import type {
  InvokeRequest,
  InvokeResponse,
  MotionBackendInput,
  MotionBackendOutput,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core/modules/types";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { aiGatewayConfigured, type AiGatewayEnv } from "../../platform/ai-gateway.js";
import { aiRunRetryable } from "../../platform/ai-run.js";
import type { GatewayI2vDoor } from "./door.js";
import { keyframeHostRefusal, KEYFRAME_NOT_PUBLIC_HINT } from "./keyframe-host.js";
import { PROVIDER_VIDEO_MAX_BYTES, readProviderMedia } from "./shared/provider-media.js";

/** cf modules/_shared/paid-generation.ts, verbatim. */
export const NOT_STORED_ERROR = "the provider finished, but the clip was not stored, and it will not be bought again";
export const NO_VIDEO_URL_ERROR = "model completed but returned no video URL";

/** Restart orphan (the local stand-in for cf's "generation workflow errored/terminated"). */
export const RESTARTED_ERROR =
  "generation interrupted: the sidecar restarted mid-generation; the provider call may already be billed and will not be repeated";

/** cf GENERATE_STEP_CONFIG and STORE_STEP_CONFIG: retries limit 2, 15 s, exponential. */
export const RETRY_DELAYS_MS = [15_000, 30_000] as const;

export type RunState =
  | { status: "running"; started_at: number; project: string; shot_id: string; seconds: number; boot_id: string }
  | { status: "done"; project: string; shot_id: string; seconds: number; clip_key: string; has_audio?: boolean }
  | { status: "failed"; error: string };

export interface PollToken { job_id: string; }

export function encodePoll(t: PollToken): string { return Buffer.from(JSON.stringify(t)).toString("base64"); }
export function decodePoll(token: string): PollToken | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as PollToken;
    if (o && typeof o.job_id === "string" && o.job_id.length > 0) return { job_id: o.job_id };
  } catch { /* fall through */ }
  return null;
}

export interface GatewayI2vContext {
  env: AiGatewayEnv;
  store: ArtifactStore;
  /** This process's identity. A `running` state from another boot is an orphan. */
  bootId: string;
  /** The paid provider call: model + params -> the provider's result. */
  generate: (model: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Fetch of the provider's media URL (never the provider's generate endpoint). */
  fetchMedia: (url: string) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Tracks background runs so tests (and shutdown) can await them. */
  onRun?: (p: Promise<void>) => void;
}

function notConfiguredMessage(door: GatewayI2vDoor<unknown>): string {
  return `${door.name}: AI Gateway not configured (set CLOUDFLARE_ACCOUNT_ID, GATEWAY_ID and CF_AIG_TOKEN)`;
}

async function writeState(ctx: GatewayI2vContext, door: GatewayI2vDoor<unknown>, jobId: string, state: RunState): Promise<void> {
  await ctx.store.put(door.stateKey(jobId), JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });
}

async function readState(ctx: GatewayI2vContext, door: GatewayI2vDoor<unknown>, jobId: string): Promise<RunState | null> {
  const obj = await ctx.store.getBytes(door.stateKey(jobId));
  if (!obj) return null;
  try {
    return JSON.parse(new TextDecoder().decode(obj.bytes)) as RunState;
  } catch {
    return null;
  }
}

async function withRetries<T>(
  ctx: GatewayI2vContext,
  fn: () => Promise<T>,
  retryable: (e: unknown) => boolean = () => true,
): Promise<T> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length || !retryable(e)) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

interface RunParams {
  jobId: string;
  project: string;
  shotId: string;
  seconds: number;
  input: MotionBackendInput;
  config: unknown;
}

/** cf runPaidGeneration, as a background task: generate (retried on throw), parse once, store (retried). */
async function runGeneration(ctx: GatewayI2vContext, door: GatewayI2vDoor<unknown>, p: RunParams): Promise<void> {
  try {
    const raw = await withRetries(ctx, () => ctx.generate(door.model, door.buildParams(p.input, p.config)), aiRunRetryable);
    const url = door.parseVideoUrl(raw);
    if (!url) throw new Error(NO_VIDEO_URL_ERROR);
    const key = door.clipKey(p.project, p.shotId);
    try {
      await withRetries(ctx, async () => {
        const vresp = await ctx.fetchMedia(url);
        if (!vresp.ok) throw new Error("video fetch " + vresp.status);
        const media = await readProviderMedia(vresp, { maxBytes: PROVIDER_VIDEO_MAX_BYTES, fallbackType: "video/mp4" });
        await ctx.store.put(key, media.bytes, { httpMetadata: { contentType: media.contentType } });
      });
    } catch (e) {
      console.error(JSON.stringify({ ev: "clip.store_failed", door: door.name, detail: e instanceof Error ? e.message : String(e) }));
      throw new Error(NOT_STORED_ERROR);
    }
    await writeState(ctx, door, p.jobId, {
      status: "done",
      project: p.project,
      shot_id: p.shotId,
      seconds: p.seconds,
      clip_key: key,
      has_audio: door.hasAudio(p.config),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeState(ctx, door, p.jobId, { status: "failed", error: msg.slice(0, 500) }).catch((we) => {
      console.error(JSON.stringify({ ev: "gateway_i2v.state_write_failed", door: door.name, detail: String(we) }));
    });
  }
}

export async function invokeGatewayI2v(
  ctx: GatewayI2vContext,
  door: GatewayI2vDoor<unknown>,
  req: InvokeRequest<MotionBackendInput>,
): Promise<InvokeResponse<MotionBackendOutput>> {
  const input = req.input;
  if (!input || !input.keyframe_url || !input.prompt || !input.shot_id) {
    return { ok: false, error: "motion.backend: input needs shot_id, keyframe_url, and prompt", reason: "bad-input" };
  }
  if (!aiGatewayConfigured(ctx.env)) return { ok: false, error: notConfiguredMessage(door), reason: "not-configured" };
  // Lead ruling on #568: refuse BEFORE any spend when the provider could not fetch the stills.
  for (const u of [input.keyframe_url, input.last_keyframe_url]) {
    const why = keyframeHostRefusal(u);
    if (why) return { ok: false, error: `${door.name}: ${why}; ${KEYFRAME_NOT_PUBLIC_HINT}`, reason: "not-configured" };
  }

  const config = door.normalizeConfig(req.config ?? {});
  const seconds = door.clampDuration(input.seconds);
  const project = req.context?.project || "project";
  const jobId = (req.context?.job_id || crypto.randomUUID()) + "-" + input.shot_id;

  // The state is written BEFORE the paid call starts (cf starts the Workflow first): a state that cannot
  // be written must never leave a generation running that nothing can poll.
  try {
    await writeState(ctx, door, jobId, {
      status: "running",
      started_at: Math.floor(Date.now() / 1000),
      project,
      shot_id: input.shot_id,
      seconds,
      boot_id: ctx.bootId,
    });
  } catch (e) {
    return { ok: false, error: `${door.name}: could not persist run state: ` + (e as Error).message };
  }

  const run = runGeneration(ctx, door, {
    jobId,
    project,
    shotId: input.shot_id,
    seconds,
    input: { ...input, seconds },
    config,
  });
  ctx.onRun?.(run);

  return { ok: true, pending: true, poll: encodePoll({ job_id: jobId }), jobId };
}

export async function pollGatewayI2v(
  ctx: GatewayI2vContext,
  door: GatewayI2vDoor<unknown>,
  body: PollRequest,
): Promise<PollResponse<MotionBackendOutput>> {
  const token = decodePoll(body.poll);
  if (!token) return { ok: false, error: `${door.name}: bad poll token` };
  const state = await readState(ctx, door, token.job_id);
  if (!state) return { ok: false, error: `${door.name}: run state not found (expired or bad token)` };
  if (state.status === "done") {
    return {
      ok: true,
      output: {
        shot_id: state.shot_id,
        clip_key: state.clip_key,
        fps: door.outFps,
        frames: state.seconds * door.outFps,
        has_audio: state.has_audio === true,
      },
    };
  }
  if (state.status === "failed") return { ok: false, error: state.error || "generation failed" };
  if (state.boot_id !== ctx.bootId) {
    await writeState(ctx, door, token.job_id, { status: "failed", error: RESTARTED_ERROR }).catch(() => {});
    return { ok: false, error: RESTARTED_ERROR };
  }
  return { ok: true, pending: true };
}
