import type {
  InvokeRequest,
  InvokeResponse,
  KeyframeInput,
  KeyframeOutput,
  MotionBackendInput,
  MotionBackendOutput,
  PollRequest,
  PollResponse,
  CancelRequest,
  CancelResponse,
  FinishInput,
  FinishOutput,
} from "@skyphusion-labs/vivijure-core";
import { runpodConfigured, resolveRunpodEndpointId, type RunpodModuleEnv } from "./env.js";
import {
  authHeader,
  cancelRunpodJobBestEffort,
  classifyGoneState,
  runpodBase,
  runpodJobGone,
  terminalErrorInOutput,
} from "./shared.js";
import {
  buildI2vBody,
  decodeI2vPoll,
  encodeI2vPoll,
  readI2vOutput,
} from "./i2v-core.js";
import {
  buildPreviewBody,
  decodeKeyframePoll,
  encodeKeyframePoll,
  parseKeyframes,
  parseTrainedLoras,
} from "./keyframe-core.js";
import {
  buildFinishBody,
  buildLipsyncBody,
  coerceFinishConfig,
  coerceLipsyncConfig,
  decodeFinishPoll,
  encodeFinishPoll,
  parseFinishOutput,
  passthroughOutput,
} from "./finish-core.js";
import { invokeFixedMotion, pollFixedMotion, FIXED_MOTION } from "./fixed-motion.js";

async function runpodCreds(
  env: RunpodModuleEnv,
  moduleName: string,
): Promise<{ apiKey: string; endpointId: string } | null> {
  if (!runpodConfigured(env, moduleName)) return null;
  return { apiKey: env.RUNPOD_API_KEY!, endpointId: resolveRunpodEndpointId(moduleName, env)! };
}

export async function invokeKeyframeRunpod(
  env: RunpodModuleEnv,
  req: InvokeRequest<KeyframeInput>,
): Promise<InvokeResponse<KeyframeOutput>> {
  const input = req.input;
  if (!input?.project || !input.bundle_key) {
    return { ok: false, error: "keyframe: input needs project and bundle_key" };
  }
  const creds = await runpodCreds(env, "keyframe");
  if (!creds) return { ok: false, error: "keyframe: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" };
  const base = runpodBase(creds.endpointId);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(creds.apiKey), "content-type": "application/json" },
      body: JSON.stringify(buildPreviewBody(input, req.config ?? {})),
    });
    if (!r.ok) return { ok: false, error: `keyframe /run -> ${r.status}` };
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: false, error: "keyframe /run returned no job id" };
    return {
      ok: true,
      pending: true,
      poll: encodeKeyframePoll({ jobId, project: input.project, submittedAt: Date.now() }),
      jobId,
    };
  } catch (e) {
    return { ok: false, error: `keyframe submit failed: ${(e as Error).message}` };
  }
}

export async function pollKeyframeRunpod(
  env: RunpodModuleEnv,
  body: PollRequest,
): Promise<PollResponse<KeyframeOutput>> {
  const st = decodeKeyframePoll(body.poll);
  if (!st) return { ok: false, error: "keyframe: bad poll token" };
  const creds = await runpodCreds(env, "keyframe");
  if (!creds) return { ok: false, error: "keyframe: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" };
  const base = runpodBase(creds.endpointId);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(creds.apiKey) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: "keyframe job not found" };
    }
    return { ok: true, pending: true };
  }
  const term = terminalErrorInOutput(s.output) ?? (typeof s.error === "string" ? s.error : null);
  if (term) return { ok: false, error: term };
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const keyframes = parseKeyframes(s.output);
  const trained_loras = parseTrainedLoras(s.output);
  return {
    ok: true,
    output: {
      project: st.project,
      keyframes,
      ...(Object.keys(trained_loras).length ? { trained_loras } : {}),
    },
  };
}

export async function invokeOwnGpu(
  env: RunpodModuleEnv,
  req: InvokeRequest<MotionBackendInput>,
): Promise<InvokeResponse<MotionBackendOutput>> {
  const input = req.input;
  if (!input?.prompt || !input.shot_id) {
    return { ok: false, error: "motion.backend: input needs shot_id and prompt" };
  }
  const creds = await runpodCreds(env, "own-gpu");
  if (!creds) return { ok: false, error: "own-gpu: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" };
  const base = runpodBase(creds.endpointId);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(creds.apiKey), "content-type": "application/json" },
      body: JSON.stringify(buildI2vBody(input, req.config ?? {}, req.context.project)),
    });
    if (!r.ok) return { ok: false, error: `own-gpu /run -> ${r.status}` };
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: false, error: "own-gpu /run returned no job id" };
    return {
      ok: true,
      pending: true,
      poll: encodeI2vPoll({
        jobId,
        project: req.context.project,
        shotId: input.shot_id,
        submittedAt: Date.now(),
      }),
    };
  } catch (e) {
    return { ok: false, error: `own-gpu submit failed: ${(e as Error).message}` };
  }
}

export async function pollOwnGpu(
  env: RunpodModuleEnv,
  body: PollRequest,
): Promise<PollResponse<MotionBackendOutput>> {
  const st = decodeI2vPoll(body.poll);
  if (!st) return { ok: false, error: "own-gpu: bad poll token" };
  const creds = await runpodCreds(env, "own-gpu");
  if (!creds) return { ok: false, error: "own-gpu: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" };
  const base = runpodBase(creds.endpointId);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(creds.apiKey) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: `own-gpu job not found (shot ${st.shotId})` };
    }
    return { ok: true, pending: true };
  }
  const term = terminalErrorInOutput(s.output) ?? (typeof s.error === "string" ? s.error : null);
  if (term) return { ok: false, error: term };
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const output = readI2vOutput(st.shotId, s.output);
  if (!output) return { ok: false, error: "own-gpu output had no clip_key" };
  return { ok: true, output };
}

async function invokeFinish(
  env: RunpodModuleEnv,
  moduleName: string,
  action: "finish_clip" | "lipsync_clip" | "upscale_clip",
  req: InvokeRequest<FinishInput>,
  extra?: Record<string, unknown>,
): Promise<InvokeResponse<FinishOutput>> {
  const input = req.input;
  if (!input?.shot_id || !input.clip_key) {
    return { ok: false, error: `${moduleName}: input needs shot_id and clip_key` };
  }
  if (action === "lipsync_clip" && !input.audio_key) {
    return { ok: true, output: passthroughOutput(input, "no-dialogue", { degraded: false }) };
  }
  const cfg = coerceFinishConfig(req.config ?? {});
  if (moduleName === "finish-rife" && !cfg.interpolate && cfg.face_restore === "none") {
    return { ok: true, output: passthroughOutput(input, "nothing-enabled", { degraded: false }) };
  }
  const creds = await runpodCreds(env, moduleName);
  if (!creds) {
    return { ok: true, output: passthroughOutput(input, "no-runpod-secrets") };
  }
  const runBody =
    action === "lipsync_clip"
      ? buildLipsyncBody(input, coerceLipsyncConfig(req.config ?? {}))
      : buildFinishBody(input, cfg, req.context.project, action, extra);
  const base = runpodBase(creds.endpointId);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(creds.apiKey), "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    if (!r.ok) {
      return { ok: true, output: passthroughOutput(input, "runpod-run-failed", { detail: `HTTP ${r.status}` }) };
    }
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) {
      return { ok: true, output: passthroughOutput(input, "runpod-run-no-id") };
    }
    return {
      ok: true,
      pending: true,
      poll: encodeFinishPoll({
        jobId,
        shotId: input.shot_id,
        clipKey: input.clip_key,
        srcFps: input.src_fps ?? 24,
        frames: input.frames ?? 0,
        submittedAt: Date.now(),
      }),
    };
  } catch (e) {
    return { ok: true, output: passthroughOutput(input, "runpod-submit-error", { detail: (e as Error).message }) };
  }
}

async function pollFinish(
  env: RunpodModuleEnv,
  moduleName: string,
  body: PollRequest,
): Promise<PollResponse<FinishOutput>> {
  const st = decodeFinishPoll(body.poll);
  if (!st) return { ok: false, error: `${moduleName}: bad poll token` };
  const creds = await runpodCreds(env, moduleName);
  if (!creds) return { ok: false, error: `${moduleName}: RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured` };
  const base = runpodBase(creds.endpointId);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(creds.apiKey) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: `${moduleName} job not found` };
    }
    return { ok: true, pending: true };
  }
  const term = terminalErrorInOutput(s.output) ?? (typeof s.error === "string" ? s.error : null);
  if (term) return { ok: false, error: term };
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const root = (s.output && typeof s.output === "object" ? s.output : null) as Record<string, unknown> | null;
  if (moduleName === "finish-lipsync" && root?.ok === false) {
    const reason =
      typeof root.detail === "string" && root.detail.length > 0
        ? root.detail
        : typeof root.error === "string" && root.error.length > 0
          ? root.error
          : undefined;
    const clipKey = st.clipKey ?? "";
    if (!clipKey) return { ok: false, error: "finish-lipsync: backend soft-degrade but poll token missing clip_key" };
    return {
      ok: true,
      output: passthroughOutput(
        { shot_id: st.shotId, clip_key: clipKey, src_fps: st.srcFps, frames: st.frames, width: 0, height: 0 },
        "backend-soft-degrade",
        { detail: reason?.slice(0, 120) },
      ),
    };
  }
  const output = parseFinishOutput(st.shotId, s.output, st.srcFps, st.frames);
  if (!output) return { ok: false, error: `${moduleName} completed but returned no clip_key` };
  return { ok: true, output };
}

export async function cancelRunpodPoll(
  env: RunpodModuleEnv,
  body: CancelRequest,
): Promise<CancelResponse> {
  const st = decodeI2vPoll(body.poll) ?? decodeKeyframePoll(body.poll) ?? decodeFinishPoll(body.poll);
  if (!st) return { ok: false, error: "bad poll token" };
  const creds = await runpodCreds(env, "");
  if (!creds) return { ok: false, error: "RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" };
  await cancelRunpodJobBestEffort(creds.apiKey, runpodBase(creds.endpointId), st.jobId);
  return { ok: true };
}

export type RunpodModuleName =
  | "keyframe"
  | "own-gpu"
  | "finish-rife"
  | "finish-lipsync"
  | "finish-upscale"
  | "seedance"
  | "kling"
  | "google-veo"
  | "minimax-hailuo"
  | "vidu-q3"
  | "alibaba-wan"
  | "alibaba-wan-lora";

export const RUNPOD_MODULE_NAMES: readonly RunpodModuleName[] = [
  "keyframe",
  "own-gpu",
  "finish-rife",
  "finish-lipsync",
  "finish-upscale",
  "seedance",
  "kling",
  "google-veo",
  "minimax-hailuo",
  "vidu-q3",
  "alibaba-wan",
  "alibaba-wan-lora",
];

export function isRunpodModuleName(name: string): name is RunpodModuleName {
  return (RUNPOD_MODULE_NAMES as readonly string[]).includes(name);
}

export function isFixedMotionModule(name: string): boolean {
  return name in FIXED_MOTION;
}

export async function invokeRunpodModule(
  env: RunpodModuleEnv,
  moduleName: RunpodModuleName,
  req: InvokeRequest,
): Promise<InvokeResponse> {
  if (moduleName === "keyframe") {
    if (req.hook !== "keyframe") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeKeyframeRunpod(env, req as InvokeRequest<KeyframeInput>);
  }
  if (moduleName === "own-gpu") {
    if (req.hook !== "motion.backend") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeOwnGpu(env, req as InvokeRequest<MotionBackendInput>);
  }
  if (isFixedMotionModule(moduleName)) {
    if (req.hook !== "motion.backend") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeFixedMotion(env, moduleName, req as InvokeRequest<MotionBackendInput>);
  }
  if (moduleName === "finish-rife") {
    if (req.hook !== "finish") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeFinish(env, moduleName, "finish_clip", req as InvokeRequest<FinishInput>);
  }
  if (moduleName === "finish-lipsync") {
    if (req.hook !== "finish") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeFinish(env, moduleName, "lipsync_clip", req as InvokeRequest<FinishInput>);
  }
  if (moduleName === "finish-upscale") {
    if (req.hook !== "finish") return { ok: false, error: "unsupported hook " + String(req.hook) };
    return invokeFinish(env, moduleName, "upscale_clip", req as InvokeRequest<FinishInput>);
  }
  return { ok: false, error: `${moduleName}: not implemented` };
}

export async function pollRunpodModule(
  env: RunpodModuleEnv,
  moduleName: RunpodModuleName,
  body: PollRequest,
): Promise<PollResponse> {
  if (moduleName === "keyframe") return pollKeyframeRunpod(env, body);
  if (moduleName === "own-gpu") return pollOwnGpu(env, body);
  if (isFixedMotionModule(moduleName)) return pollFixedMotion(env, moduleName, body);
  if (moduleName === "finish-rife" || moduleName === "finish-lipsync" || moduleName === "finish-upscale") {
    return pollFinish(env, moduleName, body);
  }
  return { ok: false, error: `${moduleName} does not support /poll` };
}

export function runpodModuleSupportsPoll(_moduleName: RunpodModuleName): boolean {
  return true;
}
