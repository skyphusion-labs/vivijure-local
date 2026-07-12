import type {
  CancelRequest,
  CancelResponse,
  InvokeRequest,
  InvokeResponse,
  MotionBackendInput,
  MotionBackendOutput,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core";
import {
  buildI2vBody,
  classifyGoneState,
  decodePoll,
  encodePoll,
  jobGone,
  readDurationGrid,
  readOutput,
} from "./i2v-core.js";

export interface LocalGpuEnv {
  LOCAL_BACKEND_URL?: string;
  LOCAL_BACKEND_TOKEN?: string;
}

export function localGpuConfigured(env: LocalGpuEnv): boolean {
  return Boolean(env.LOCAL_BACKEND_URL?.trim());
}

function backendCfg(env: LocalGpuEnv): { baseUrl: string; token: string } {
  return {
    baseUrl: (env.LOCAL_BACKEND_URL ?? "").replace(/\/+$/, ""),
    token: env.LOCAL_BACKEND_TOKEN?.trim() ?? "",
  };
}

function authHeaders(token: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function doorDurationGrid(env: LocalGpuEnv): Promise<ReturnType<typeof readDurationGrid>> {
  const { baseUrl, token } = backendCfg(env);
  if (!baseUrl) return null;
  try {
    const r = await fetch(`${baseUrl}/health`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    return readDurationGrid(((await r.json()) as { duration_grid?: unknown }).duration_grid);
  } catch {
    return null;
  }
}

export async function invokeLocalGpu(
  env: LocalGpuEnv,
  req: InvokeRequest<MotionBackendInput>,
): Promise<InvokeResponse<MotionBackendOutput>> {
  const input = req.input;
  if (!input?.prompt || !input.shot_id) {
    return { ok: false, error: "motion.backend: input needs shot_id and prompt" };
  }
  const { baseUrl, token } = backendCfg(env);
  if (!baseUrl) return { ok: false, error: "local-gpu: LOCAL_BACKEND_URL not configured" };
  try {
    const r = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(buildI2vBody(input, req.config ?? {}, req.context.project)),
    });
    if (!r.ok) return { ok: false, error: `local-gpu /run -> ${r.status}` };
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: false, error: "local-gpu /run returned no job id" };
    return {
      ok: true,
      pending: true,
      poll: encodePoll({
        jobId,
        project: req.context.project,
        shotId: input.shot_id,
        submittedAt: Date.now(),
      }),
      jobId,
    };
  } catch (e) {
    return { ok: false, error: `local-gpu submit failed: ${(e as Error).message}` };
  }
}

export async function pollLocalGpu(
  env: LocalGpuEnv,
  body: PollRequest,
): Promise<PollResponse<MotionBackendOutput>> {
  const st = decodePoll(body.poll);
  if (!st) return { ok: false, error: "local-gpu: bad poll token" };
  const { baseUrl, token } = backendCfg(env);
  if (!baseUrl) return { ok: false, error: "local-gpu: LOCAL_BACKEND_URL not configured" };

  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${baseUrl}/status/${st.jobId}`, { headers: authHeaders(token) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (jobGone(httpStatus, s as { status?: unknown; title?: unknown })) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: `local-gpu job not found (shot ${st.shotId})` };
    }
    return { ok: true, pending: true };
  }
  if (s.status === "FAILED") {
    return { ok: false, error: `local-gpu job failed: ${JSON.stringify(s.error ?? s).slice(0, 200)}` };
  }
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const output = readOutput(st.shotId, s.output);
  if (!output) return { ok: false, error: "local-gpu output had no clip_key" };
  return { ok: true, output };
}

export async function cancelLocalGpu(env: LocalGpuEnv, body: CancelRequest): Promise<CancelResponse> {
  const st = decodePoll(body.poll);
  if (!st) return { ok: false, error: "local-gpu: bad poll token" };
  const { baseUrl, token } = backendCfg(env);
  if (!baseUrl) return { ok: false, error: "local-gpu: LOCAL_BACKEND_URL not configured" };
  try {
    const resp = await fetch(`${baseUrl}/cancel/${st.jobId}`, {
      method: "POST",
      headers: authHeaders(token),
    });
    if (resp.ok || resp.status === 404) return { ok: true };
    return { ok: false, error: `local-gpu /cancel -> ${resp.status}` };
  } catch (e) {
    return { ok: false, error: `local-gpu cancel failed: ${(e as Error).message}` };
  }
}

export function localGpuEnvFromProcess(env: NodeJS.ProcessEnv): LocalGpuEnv {
  return {
    LOCAL_BACKEND_URL: env.LOCAL_BACKEND_URL?.trim() || undefined,
    LOCAL_BACKEND_TOKEN: env.LOCAL_BACKEND_TOKEN?.trim() || undefined,
  };
}
