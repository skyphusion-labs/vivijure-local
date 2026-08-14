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
  localFinishUrlsFor,
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
import { orderDoors, resetDoorCursorsForTests } from "../door-pool.js";
import { classifyGoneState, runpodJobGone, runpodFaultMarkers, runpodTerminalFailure, terminalErrorInOutput } from "../runpod/shared.js";
import { ensureOllamaUnloadedForGpu } from "../chain/ollama.js";

/** Local HTTP finish modules only; finish-rife has no local image (Conrad 2026-07-28). */
export type LocalFinishModuleName = "finish-lipsync" | "finish-upscale";

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
    moduleName === "finish-lipsync" ? "LOCAL_FINISH_LIPSYNC_URL" : "LOCAL_FINISH_UPSCALE_URL";
  return `${moduleName}: FINISH_BACKEND=local but ${urlKey} is unset`;
}

/**
 * Door selection (health probe, single-door-no-probe, rotation) moved to `../door-pool.ts` so the
 * speech door uses the SAME selector rather than a second one. Behaviour here is unchanged; the
 * cursor is now keyed per pool, which for a one-module-per-process sidecar is the same counter.
 */

/** Reset between tests; kept at this name because local#378's suite imports it from here. */
export function __resetDoorCursorForTests(): void {
  resetDoorCursorsForTests();
}

export async function invokeLocalFinish(
  env: FinishBackendEnv,
  moduleName: LocalFinishModuleName,
  action: "lipsync_clip" | "upscale_clip",
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
  const misconfigured = cfgError(moduleName, env);
  if (misconfigured) return { ok: false, error: misconfigured };
  const { urls, dropped } = localFinishUrlsFor(moduleName, env);
  if (dropped > 0) {
    // Never silent: a dropped entry is lost capacity, and the operator's variable looks fine.
    console.warn(
      `${moduleName}: ${dropped} unusable entr${dropped === 1 ? "y" : "ies"} dropped from the ` +
        `local finish door list; ${urls.length} usable`,
    );
  }
  const runBody =
    action === "lipsync_clip"
      ? buildLipsyncBody(input, coerceLipsyncConfig(req.config ?? {}))
      : buildFinishBody(input, cfg, req.context.project, action, extra);
  // Sequential VRAM: local finish GPU shares the card with Ollama + the door.
  await ensureOllamaUnloadedForGpu(env);

  const ordered = await orderDoors(urls);
  if (ordered.length === 0) {
    // DISTINGUISHABLE FROM UNSET, deliberately: "configured but nothing answers" and "not
    // configured" are different facts and an operator acts differently on each. cfgError above
    // already covers the unset case by name.
    return {
      ok: false,
      error: `${moduleName}: no healthy local finish door (${urls.length} configured, 0 reachable)`,
    };
  }

  let lastError = "";
  for (let i = 0; i < ordered.length; i += 1) {
    const baseUrl = ordered[i];
    try {
      const r = await fetch(`${baseUrl}/run`, {
        method: "POST",
        headers: { ...authHeaders(env.LOCAL_FINISH_TOKEN), "content-type": "application/json" },
        body: JSON.stringify(runBody),
      });
      if (!r.ok) {
        lastError = `local finish /run -> ${r.status}`;
      } else {
        const jobId = ((await r.json()) as { id?: string }).id;
        if (!jobId) {
          lastError = "local finish /run returned no job id";
        } else {
          if (i > 0) {
            // Failover is the FEATURE here (the opposite of the proxy rule, where falling back
            // defeats the purpose) -- but a silent retry turns a permanently dead card into an
            // invisible 50% capacity loss, so both doors are always named.
            console.warn(
              `${moduleName}: local finish failed over -- ${ordered[i - 1]} did not serve ` +
                `(${lastError}); ${baseUrl} did`,
            );
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
              doorUrl: baseUrl,
            }),
          };
        }
      }
    } catch (e) {
      lastError = `local finish submit error: ${(e as Error).message}`;
    }
  }
  return { ok: false, error: `${moduleName}: ${lastError}` };
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
  // AFFINITY, not rotation: the job id lives in the serving door's in-process registry, so polling
  // any other door 404s and would read a healthy job as gone. Tokens minted before `doorUrl`
  // existed, or naming a door no longer configured, fall back to the head of the pool -- which is
  // exactly the single-door behaviour they were minted under.
  const doors = localFinishUrlsFor(moduleName, env).urls;
  const baseUrl = st.doorUrl && doors.includes(st.doorUrl) ? st.doorUrl : doors[0];
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
  if (term) return { ok: false, error: term, ...runpodFaultMarkers(s) };
  const failed = runpodTerminalFailure(moduleName, s);
  if (failed) return failed;
  if (s.status !== "COMPLETED") return { ok: true, pending: true };
  const output = parseFinishOutput(st.shotId, s.output, st.srcFps, st.frames);
  if (!output) return { ok: false, error: `${moduleName} completed but returned no clip_key` };
  return { ok: true, output };
}
