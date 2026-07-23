import type {
  FinishInput,
  FinishOutput,
  InvokeRequest,
  InvokeResponse,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core";
import {
  finishBackendFromProcess,
  localFinishConfigured,
  localFinishUrlFor,
  resolveFinishBackend,
  type FinishBackendEnv,
} from "../finish-backend.js";
import {
  buildFinishBody,
  buildLipsyncBody,
  coerceFinishConfig,
  coerceLipsyncConfig,
  decodeFinishPoll,
  encodeFinishPoll,
  parseFinishOutput,
  passthroughOutput,
} from "../runpod/finish-core.js";
import { classifyGoneState, runpodJobGone, runpodTerminalFailure, terminalErrorInOutput } from "../runpod/shared.js";

export type LocalFinishModuleName = "finish-rife" | "finish-lipsync" | "finish-upscale";

export function localFinishEnvFromProcess(env: NodeJS.ProcessEnv): FinishBackendEnv {
  return finishBackendFromProcess(env);
}

function authHeaders(token: string | undefined): Record<string, string> {
  const t = token?.trim();
  return t ? { authorization: `Bearer ${t}` } : {};
}

function cfgError(moduleName: string, env: FinishBackendEnv): string | null {
  if (resolveFinishBackend(moduleName, env) !== "local") {
    return `${moduleName}: FINISH_BACKEND is not local`;
  }
  if (localFinishConfigured(moduleName, env)) return null;
  const urlKey =
    moduleName === "finish-rife"
      ? "LOCAL_FINISH_RIFE_URL"
      : moduleName === "finish-lipsync"
        ? "LOCAL_FINISH_LIPSYNC_URL"
        : "LOCAL_FINISH_UPSCALE_URL";
  return `${moduleName}: FINISH_BACKEND=local but ${urlKey} is unset`;
}

export async function invokeLocalFinish(
  env: FinishBackendEnv,
  moduleName: LocalFinishModuleName,
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
  const misconfigured = cfgError(moduleName, env);
  if (misconfigured) return { ok: false, error: misconfigured };
  const baseUrl = localFinishUrlFor(moduleName, env)!;
  const runBody =
    action === "lipsync_clip"
      ? buildLipsyncBody(input, coerceLipsyncConfig(req.config ?? {}))
      : buildFinishBody(input, cfg, req.context.project, action, extra);
  try {
    const r = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { ...authHeaders(env.LOCAL_FINISH_TOKEN), "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    if (!r.ok) return { ok: false, error: `${moduleName}: local finish /run -> ${r.status}` };
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: false, error: `${moduleName}: local finish /run returned no job id` };
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
    return { ok: false, error: `${moduleName}: local finish submit error: ${(e as Error).message}` };
  }
}

export async function pollLocalFinish(
  env: FinishBackendEnv,
  moduleName: LocalFinishModuleName,
  body: PollRequest,
): Promise<PollResponse<FinishOutput>> {
  const st = decodeFinishPoll(body.poll);
  if (!st) return { ok: false, error: `${moduleName}: bad poll token` };
  const misconfigured = cfgError(moduleName, env);
  if (misconfigured) return { ok: false, error: misconfigured };
  const baseUrl = localFinishUrlFor(moduleName, env)!;
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${baseUrl}/status/${st.jobId}`, {
      headers: authHeaders(env.LOCAL_FINISH_TOKEN),
    });
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
  const failed = runpodTerminalFailure(moduleName, s);
  if (failed) return failed;
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const output = parseFinishOutput(st.shotId, s.output, st.srcFps, st.frames);
  if (!output) return { ok: false, error: `${moduleName} completed but returned no clip_key` };
  return { ok: true, output };
}
