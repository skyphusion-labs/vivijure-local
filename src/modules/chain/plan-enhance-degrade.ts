/**
 * local#324: machine-readable plan.enhance fail-open signal.
 *
 * Fail-open stays correct for render (dead planner must not block a shot). What was wrong is that
 * UP vs STOPPED both returned only `ok: true` + a prose note, so a monitor watching `ok` (or HTTP
 * status) could never see Ollama die. These fields are additive, content-free, and closed-set;
 * assert on them, never on the English notes.
 */
import type { PlanEnhanceOutput, PlanEnhanceStoryboard } from "@skyphusion-labs/vivijure-core";
import { OllamaError } from "./ollama.js";

/** Why plan/enhance/refine skipped while still returning ok:true. */
export type PlanDegradeReason = "provider_unreachable" | "invalid_reply" | "no_reply";

/** Additive fields on PlanEnhanceOutput when the director pass soft-degraded. */
export interface PlanEnhanceDegradeFields {
  degraded: true;
  degrade_reason: PlanDegradeReason;
  /**
   * Only when the selected provider was Ollama:
   * - false: configured Ollama did not serve (fetch/network/dead process)
   * - true: Ollama answered but the reply was unusable (parse miss / empty)
   * Absent when the selected provider was not Ollama.
   */
  ollama_reachable?: boolean;
}

export type PlanEnhanceOutputDegraded = PlanEnhanceOutput & PlanEnhanceDegradeFields;

/**
 * Classify a thrown provider error into a degrade reason.
 *
 * The reason must come from the ERROR, never from which branch caught it. callOllama throws
 * for four distinguishable conditions and only a rejected fetch is unreachability; a 404
 * "model not found, try pulling it first" and an empty 200 both mean Ollama is UP. Hardcoding
 * the catch arm to provider_unreachable reports ollama_reachable:false for a healthy server
 * whose model is simply not pulled, and an operator paged on that restarts a working container.
 *
 * Unknown (non-Ollama) provider errors stay conservative at provider_unreachable.
 */
export function degradeReasonFromError(e: unknown): PlanDegradeReason {
  if (e instanceof OllamaError) {
    return e.answered ? "no_reply" : "provider_unreachable";
  }
  return "provider_unreachable";
}

export function planFailOpenOutput(
  storyboard: PlanEnhanceStoryboard,
  note: string,
  reason: PlanDegradeReason,
  opts?: { ollamaSelected?: boolean },
): PlanEnhanceOutputDegraded {
  const out: PlanEnhanceOutputDegraded = {
    storyboard,
    notes: [note],
    degraded: true,
    degrade_reason: reason,
  };
  if (opts?.ollamaSelected) {
    // Unreachable => false. Served-but-unusable (invalid/empty) => true.
    out.ollama_reachable = reason !== "provider_unreachable";
  }
  return out;
}
