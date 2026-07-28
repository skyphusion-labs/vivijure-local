/**
 * cast.image provider pick (local#269).
 *
 * Homelab first-win: CAST_IMAGE_BACKEND_URL → local FLUX.2 Klein 4B (Apache-2.0).
 * Workers AI / nano-banana remain opt-in overlays when CF creds are set.
 */
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { generateCastImageWorkersAi } from "./cast-image-gen.js";
import {
  LOCAL_CAST_MODEL,
  callLocalCastImage,
  castImageLocalConfigured,
  isLocalCastModelId,
  unloadLocalCastImageBestEffort,
  type CastImageLocalEnv,
} from "./cast-image-local.js";
import { ensureOllamaUnloadedForGpu, type OllamaEnv } from "./ollama.js";

export type CastImageProvider = "local" | "workers-ai";

export interface CastImageProviderEnv extends AiGatewayEnv, CastImageLocalEnv, OllamaEnv {
  CAST_IMAGE_MOCK?: string;
}

export function workersAiCastConfigured(env: CastImageProviderEnv): boolean {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      (env.CF_AIG_TOKEN?.trim() || env.CLOUDFLARE_API_TOKEN?.trim()),
  );
}

/**
 * Provider pick order (homelab first-win):
 * 1. Explicit local/* model id + CAST_IMAGE_BACKEND_URL → local
 * 2. CAST_IMAGE_BACKEND_URL set (and model is not an explicit CF/google overlay) → local
 * 3. Explicit @cf/ or google/ with CF creds → workers-ai
 * 4. CF creds → workers-ai
 * 5. else → local if URL set, else workers-ai (caller fails with clear error)
 */
export function pickCastImageProvider(env: CastImageProviderEnv, modelId?: string): CastImageProvider {
  const model = modelId?.trim() || "";
  const localReady = castImageLocalConfigured(env);
  const cloudReady = workersAiCastConfigured(env);

  if (isLocalCastModelId(model) && localReady) return "local";
  if (model.startsWith("@cf/") || model.startsWith("google/")) {
    if (cloudReady) return "workers-ai";
    if (localReady) return "local";
    return "workers-ai";
  }
  if (localReady) return "local";
  return "workers-ai";
}

export function resolveCastImageModel(
  env: CastImageProviderEnv,
  requested?: string,
): { provider: CastImageProvider; model: string } {
  const provider = pickCastImageProvider(env, requested);
  if (provider === "local") {
    return { provider, model: LOCAL_CAST_MODEL };
  }
  const model = requested?.trim() || "@cf/black-forest-labs/flux-2-klein-4b";
  return { provider, model };
}

export async function generateCastImageViaProvider(
  env: CastImageProviderEnv,
  model: string,
  prompt: string,
  refUrls: string[],
): Promise<{ bytes: Uint8Array; mime: string; model: string; provider: CastImageProvider }> {
  const { provider, model: resolved } = resolveCastImageModel(env, model);

  if (provider === "local") {
    if (!castImageLocalConfigured(env)) {
      throw new Error(
        "cast.image local: CAST_IMAGE_BACKEND_URL is not set. " +
          "Enable the cast-image compose profile (FLUX.2 Klein 4B) or set the URL; " +
          "CF Workers AI is opt-in only (set CLOUDFLARE_ACCOUNT_ID + CF_AIG_TOKEN).",
      );
    }
    // Sequential VRAM (local#269 / #265): free Ollama before Klein claims the card.
    await ensureOllamaUnloadedForGpu(env);
    const img = await callLocalCastImage(env, prompt, refUrls);
    return { ...img, model: resolved, provider };
  }

  if (!workersAiCastConfigured(env)) {
    throw new Error(
      "cast.image: no provider configured. Set CAST_IMAGE_BACKEND_URL for local Klein 4B " +
        "(Apache-2.0, no Cloudflare), or set CLOUDFLARE_ACCOUNT_ID + CF_AIG_TOKEN for Workers AI overlay.",
    );
  }

  const img = await generateCastImageWorkersAi(env, resolved, prompt, refUrls);
  return { ...img, model: resolved, provider };
}

/** After a cast.image job finishes (all prompts done), release local GPU if used. */
export async function unloadCastImageGpuBestEffort(env: CastImageProviderEnv): Promise<void> {
  if (castImageLocalConfigured(env)) {
    await unloadLocalCastImageBestEffort(env);
  }
}
