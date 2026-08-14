/**
 * Shared RunPod async helpers (ported from vivijure module workers).
 */

import { reconcileRunpodEndpointWorkersMax } from "@skyphusion-labs/vivijure-core/runpod-endpoint-reconcile";
import { parseRunpodErrorType } from "../../runpod-job-log.js";

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

/**
 * local#304: closed-set classification the module poll already computed and must carry ACROSS the
 * envelope so the studio can write runpod_job_log.outcome without parsing English error strings.
 * Content-free by construction. Absent on non-RunPod faults (bad token, missing config) so those
 * keep the studio default of `failed`.
 */
export type RunpodPollOutcome = "backend-error" | "failed" | "gone" | "cancelled";

/** cf#288 / cf#298 parity: the machine-readable fault markers a module poll must carry ACROSS the
 *  envelope. The studio writes the runpod_job_log row on this door and never sees the RunPod /status
 *  payload, so anything the envelope does not carry is unrecoverable downstream. Both fields are
 *  OPTIONAL and machine-generated; absent means "the endpoint did not report one", which must stay
 *  distinguishable from "reported, and it was not a fault of that kind". */
export interface RunpodFaultMarkers {
  /** RunPod's own terminal status when it reported one, so the studio can record a CANCELLED job as
   *  `cancelled` rather than flattening it into `failed`. */
  runpodStatus?: string;
  /** The exception CLASS from the structured `error_type` key, e.g. HarnessError. This is what
   *  separates a deliberate refusal from an OOM; both arrive as RunPod FAILED. */
  errorType?: string;
  /** local#304: which closed outcome the module classified this poll as. */
  outcome?: RunpodPollOutcome;
}

/** Build the markers from a RunPod /status body. Reads STRUCTURED keys only; never the message. */
export function runpodFaultMarkers(s: { status?: string; error?: unknown; output?: unknown }): RunpodFaultMarkers {
  const markers: RunpodFaultMarkers = {};
  if (typeof s.status === "string" && s.status) markers.runpodStatus = s.status;
  const errorType = parseRunpodErrorType(s.error) ?? parseRunpodErrorType(s.output);
  if (errorType) markers.errorType = errorType;
  return markers;
}

/** #47: a RunPod job in a terminal FAILURE state that carries NO error string -- TIMED_OUT, CANCELLED,
 *  or FAILED with a crashed/OOM worker (non-string `error`) -- must fail the shot, not poll `pending`
 *  forever. terminalErrorInOutput + a string `error` only catch the error-carrying failures; these
 *  states fall through and hang the render otherwise. Call after the jobGone/term checks and before the
 *  `!== "COMPLETED"` pending return, mirroring pollLocalGpu's explicit FAILED branch. Returns the failed
 *  envelope, or null when the status is not one of these terminal-failure states (still running/queued).
 *
 *  The RENDER-PATH verdict is unchanged by the markers: this still returns ok:false for the same three
 *  statuses it always did. The markers are additive telemetry and nothing reads them to decide a shot. */
export function runpodTerminalFailure(
  label: string,
  s: { status?: string; error?: unknown },
): ({ ok: false; error: string } & RunpodFaultMarkers) | null {
  if (s.status === "FAILED" || s.status === "CANCELLED" || s.status === "TIMED_OUT") {
    return {
      ok: false,
      error: `${label} job ${s.status}: ${JSON.stringify(s.error ?? s).slice(0, 200)}`,
      ...runpodFaultMarkers(s),
      // local#304: CANCELLED is its own outcome; FAILED and TIMED_OUT stay failed.
      outcome: s.status === "CANCELLED" ? "cancelled" : "failed",
    };
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
