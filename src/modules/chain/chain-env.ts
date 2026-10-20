import type { PlannerEnv } from "../../planner-env.js";
import { plannerEnvFromProcess } from "../../planner-env.js";

export type ChainModuleEnv = PlannerEnv & {
  CLOUDFLARE_API_TOKEN?: string;
  ENHANCE_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_PLAN_MODEL?: string;
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?: string;
  RUNPOD_WORKERS_MAX?: string;
  /** Comma-separated on-box speech door pool (local#383); same shape as LOCAL_FINISH_*_URL. */
  LOCAL_FINISH_SPEECH_URL?: string;
  /** Shared bearer for the on-box LOCAL_FINISH_* doors; the speech door is one of them. */
  LOCAL_FINISH_TOKEN?: string;
  /**
   * Comma-separated on-box cast.image door pool (local#269). Same list shape as
   * LOCAL_FINISH_SPEECH_URL, parsed by the same door-pool selector.
   */
  CAST_IMAGE_BACKEND_URL?: string;
  /** Optional bearer for the cast.image door; mirrors CAST_IMAGE_TOKEN in containers/cast-image. */
  CAST_IMAGE_TOKEN?: string;
};

export function chainModuleEnvFromProcess(processEnv: NodeJS.ProcessEnv = process.env): ChainModuleEnv {
  return {
    ...plannerEnvFromProcess(processEnv),
    CLOUDFLARE_API_TOKEN: processEnv.CLOUDFLARE_API_TOKEN,
    ENHANCE_MODEL: processEnv.ENHANCE_MODEL,
    OLLAMA_BASE_URL: processEnv.OLLAMA_BASE_URL?.trim() || undefined,
    OLLAMA_PLAN_MODEL: processEnv.OLLAMA_PLAN_MODEL?.trim() || undefined,
    RUNPOD_API_KEY: processEnv.RUNPOD_API_KEY?.trim() || undefined,
    RUNPOD_ENDPOINT_ID: processEnv.RUNPOD_ENDPOINT_ID?.trim() || undefined,
    AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: processEnv.AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    RUNPOD_WORKERS_MAX: processEnv.RUNPOD_WORKERS_MAX?.trim() || undefined,
    LOCAL_FINISH_SPEECH_URL: processEnv.LOCAL_FINISH_SPEECH_URL?.trim() || undefined,
    LOCAL_FINISH_TOKEN: processEnv.LOCAL_FINISH_TOKEN?.trim() || undefined,
    CAST_IMAGE_BACKEND_URL: processEnv.CAST_IMAGE_BACKEND_URL?.trim() || undefined,
    CAST_IMAGE_TOKEN: processEnv.CAST_IMAGE_TOKEN?.trim() || undefined,
  };
}

export function chainModuleEnvFromRuntime(runtime: { asProcessEnv(): NodeJS.ProcessEnv }): ChainModuleEnv {
  return chainModuleEnvFromProcess(runtime.asProcessEnv());
}

export function speechRunpodEndpointId(env: ChainModuleEnv): string | undefined {
  return env.AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
}

export function speechRunpodConfigured(env: ChainModuleEnv): boolean {
  return Boolean(env.RUNPOD_API_KEY?.trim() && speechRunpodEndpointId(env));
}

/** The raw, untrimmed-of-meaning door list. Non-empty means the operator asked for a local door. */
export function speechLocalDoorRaw(env: ChainModuleEnv): string {
  return env.LOCAL_FINISH_SPEECH_URL?.trim() ?? "";
}

export type SpeechBackend = "local-door" | "runpod" | "mock";

/**
 * WHERE speech-upscale sends work. ONE resolver; there is no second selection path.
 *
 * `LOCAL_FINISH_SPEECH_URL` WINS ON PRESENCE, NOT ON USABILITY, and that asymmetry against
 * `localFinishConfigured` is deliberate (Conrad, local#383: "don't want anything going to those
 * endpoints anymore"). Writing a value into this variable IS the operator saying "keep speech off
 * RunPod". If a typo in it were read as "unset", the fall-through would be a cloud call to
 * `vivijure-audio-upscale` -- the exact traffic the variable exists to stop, arriving silently and
 * looking like success. So a set-but-unusable value degrades honestly and stops here; only a
 * genuinely empty variable falls through to RunPod.
 *
 * The finish sidecars can be laxer because their fall-through is a refusal, not a cloud call.
 *
 * `mock` is the pre-existing byte-copy stand-in, unchanged: it applies only when neither a door nor
 * RunPod is configured, which is exactly when it applied before local#383.
 */
export function resolveSpeechBackend(env: ChainModuleEnv): SpeechBackend {
  if (speechLocalDoorRaw(env)) return "local-door";
  if (speechRunpodConfigured(env)) return "runpod";
  return "mock";
}

/** The raw, untrimmed-of-meaning cast.image door list. Non-empty means the operator asked for it. */
export function castImageLocalDoorRaw(env: ChainModuleEnv): string {
  return env.CAST_IMAGE_BACKEND_URL?.trim() ?? "";
}

export type CastImageBackend = "local-door" | "workers-ai";

/**
 * WHERE cast.image sends work (local#269, under epic local#200). ONE resolver; there is no second
 * selection path, for the same reason door-pool.ts exists.
 *
 * `CAST_IMAGE_BACKEND_URL` WINS ON PRESENCE, NOT ON USABILITY, exactly as LOCAL_FINISH_SPEECH_URL
 * does, and for a sharper reason than that one. Three things make the fall-through wrong here:
 *
 *   1. Writing a value into this variable IS the operator saying "generate my cast references on
 *      my own card". Reading a typo as "unset" would send the job to Workers AI, which is the
 *      cloud dependency epic local#200 exists to make optional, arriving silently and looking like
 *      success.
 *   2. The cloud default is `@cf/black-forest-labs/flux-2-klein-9b`. ernst's licence read on
 *      local#269 (2026-09-26) found BFL ToS 1.3(n) forbids using Output to "train, distill or
 *      fine-tune any other AI models", and the entire purpose of cast.image is a LoRA training
 *      set. vivijure-cf#751 settled the Cloudflare path for INFERENCE; a silent failure-path
 *      switch into it for TRAINING data is not a decision this resolver gets to make.
 *   3. A homelabber running the local door usually holds no CLOUDFLARE_ACCOUNT_ID or CF_AIG_TOKEN
 *      at all, so the "fallback" surfaces as an obscure auth error several layers down rather
 *      than a sentence naming the door that did not answer.
 *
 * So a set-but-unusable value fails loud and stops here; only a genuinely empty variable reaches
 * Workers AI. Unlike speech-upscale this is NOT a polish step, so the stop is `ok: false` and not
 * an honest degrade -- see the contract note on generateCastImageLocal.
 */
export function resolveCastImageBackend(env: ChainModuleEnv): CastImageBackend {
  if (castImageLocalDoorRaw(env)) return "local-door";
  return "workers-ai";
}
