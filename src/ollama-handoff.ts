/**
 * Studio-side sequential VRAM handoff (local#265).
 *
 * Call before startFilmJob / startFilmFromKeyframes / startScatterRender so Ollama
 * is unloaded even if plan.enhance ran recently (keep_alive window) and before the
 * local-gpu module receives /invoke. Module sidecars also unload again at /run.
 */
import { ensureOllamaUnloadedForGpu } from "./modules/chain/ollama.js";

export async function unloadOllamaBeforeRender(
  env: Record<string, unknown> | NodeJS.ProcessEnv,
): Promise<void> {
  await ensureOllamaUnloadedForGpu(env);
}
