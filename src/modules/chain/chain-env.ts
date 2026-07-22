import type { PlannerEnv } from "../../planner-env.js";
import { plannerEnvFromProcess } from "../../planner-env.js";

export type ChainModuleEnv = PlannerEnv & {
  CLOUDFLARE_API_TOKEN?: string;
  ENHANCE_MODEL?: string;
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?: string;
  RUNPOD_WORKERS_MAX?: string;
};

export function chainModuleEnvFromProcess(processEnv: NodeJS.ProcessEnv = process.env): ChainModuleEnv {
  return {
    ...plannerEnvFromProcess(processEnv),
    CLOUDFLARE_API_TOKEN: processEnv.CLOUDFLARE_API_TOKEN,
    ENHANCE_MODEL: processEnv.ENHANCE_MODEL,
    RUNPOD_API_KEY: processEnv.RUNPOD_API_KEY?.trim() || undefined,
    RUNPOD_ENDPOINT_ID: processEnv.RUNPOD_ENDPOINT_ID?.trim() || undefined,
    AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: processEnv.AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    RUNPOD_WORKERS_MAX: processEnv.RUNPOD_WORKERS_MAX?.trim() || undefined,
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
