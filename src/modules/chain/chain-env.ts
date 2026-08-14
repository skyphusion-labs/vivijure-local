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
