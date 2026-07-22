/**
 * Shared RunPod async helpers (ported from vivijure module workers).
 */

import { reconcileRunpodEndpointWorkersMax } from "@skyphusion-labs/vivijure-core/runpod-endpoint-reconcile";

export const RUNPOD_COLD_GRACE_MS = 90_000;

export function runpodBase(endpointIdOrUrl: string): string {
  if (endpointIdOrUrl.startsWith("http")) return endpointIdOrUrl.replace(/\/+$/, "");
  return `https://api.runpod.ai/v2/${endpointIdOrUrl}`;
}

export function authHeader(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

export interface PollState {
  jobId: string;
  project: string;
  shotId: string;
  submittedAt?: number;
  seconds?: number;
  extra?: Record<string, unknown>;
}

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

export function terminalErrorInOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const err = o.error ?? o.detail ?? o.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return null;
}

/** #47: a RunPod job in a terminal FAILURE state that carries NO error string -- TIMED_OUT, CANCELLED,
 *  or FAILED with a crashed/OOM worker (non-string `error`) -- must fail the shot, not poll `pending`
 *  forever. terminalErrorInOutput + a string `error` only catch the error-carrying failures; these
 *  states fall through and hang the render otherwise. Call after the jobGone/term checks and before the
 *  `!== "COMPLETED"` pending return, mirroring pollLocalGpu's explicit FAILED branch. Returns the failed
 *  envelope, or null when the status is not one of these terminal-failure states (still running/queued). */
export function runpodTerminalFailure(
  label: string,
  s: { status?: string; error?: unknown },
): { ok: false; error: string } | null {
  if (s.status === "FAILED" || s.status === "CANCELLED" || s.status === "TIMED_OUT") {
    return { ok: false, error: `${label} job ${s.status}: ${JSON.stringify(s.error ?? s).slice(0, 200)}` };
  }
  return null;
}

export function runpodJobGone(httpStatus: number, body: unknown): boolean {
  if (httpStatus === 404) return true;
  if (body && typeof body === "object") {
    const s = String((body as Record<string, unknown>).error ?? "").toLowerCase();
    if (s.includes("not found") || s.includes("does not exist")) return true;
  }
  return false;
}

export function classifyGoneState(submittedAt: number | undefined, nowMs: number): "gone-pending" | "gone-failed" {
  if (submittedAt == null) return "gone-failed";
  return nowMs - submittedAt < RUNPOD_COLD_GRACE_MS ? "gone-pending" : "gone-failed";
}

export async function cancelRunpodJobBestEffort(apiKey: string, base: string, jobId: string): Promise<void> {
  try {
    await fetch(`${base}/cancel/${jobId}`, { method: "POST", headers: authHeader(apiKey) });
  } catch {
    /* best-effort */
  }
}

/** cf#61: restore workersMax before /run when configured; fail closed with guidance on 401. */
export async function reconcileWorkersMaxOrError(
  label: string,
  apiKey: string,
  endpointId: string,
  workersMax: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (workersMax == null) return { ok: true };
  const rec = await reconcileRunpodEndpointWorkersMax({
    apiKey,
    endpointId,
    spec: { workersMax },
  });
  if (rec.ok) return { ok: true };
  const msg = rec.guidance ? `${rec.error}. ${rec.guidance}` : rec.error;
  return { ok: false, error: `${label}: ${msg}` };
}
