/**
 * Studio-side sequential VRAM handoff (local#265 / local#325).
 *
 * Call before startFilmJob / startFilmFromKeyframes so Ollama
 * is unloaded even if plan.enhance ran recently (keep_alive window) and before the
 * local-gpu module receives /invoke. Module sidecars also unload again at /run.
 *
 * Returns the structured unload result (skipped | unloaded | failed). Render entry
 * points stay fail-open: a failed unload must not block the film, but the caller
 * now receives the outcome instead of discarding a void/boolean (local#325).
 */
import {
  ensureOllamaUnloadedForGpu,
  type OllamaUnloadResult,
} from "./modules/chain/ollama.js";

export type { OllamaUnloadResult };

export async function unloadOllamaBeforeRender(
  env: Record<string, unknown> | NodeJS.ProcessEnv,
): Promise<OllamaUnloadResult> {
  return ensureOllamaUnloadedForGpu(env);
}
