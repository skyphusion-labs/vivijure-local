export interface RunpodModuleEnv {
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  /** Wan i2v / own-gpu backend (upstream: BACKEND_RUNPOD_ENDPOINT_ID). Falls back to RUNPOD_ENDPOINT_ID. */
  BACKEND_RUNPOD_ENDPOINT_ID?: string;
  /** SDXL keyframe endpoint when split from the i2v backend. Falls back to RUNPOD_ENDPOINT_ID. */
  KEYFRAME_RUNPOD_ENDPOINT_ID?: string;
  VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID?: string;
  MUSETALK_RUNPOD_ENDPOINT_ID?: string;
  AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?: string;
  /** cf#61: expected workersMax for pre-submit idle reconcile (matches cf module wrangler vars). */
  RUNPOD_WORKERS_MAX?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_FORCE_PATH_STYLE?: string;
}

export function resolveRunpodEndpointId(moduleName: string, env: RunpodModuleEnv): string | undefined {
  if (moduleName === "finish-upscale") {
    return env.VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
  }
  if (moduleName === "finish-lipsync") {
    return env.MUSETALK_RUNPOD_ENDPOINT_ID?.trim() || env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
  }
  if (moduleName === "keyframe") {
    return env.KEYFRAME_RUNPOD_ENDPOINT_ID?.trim() || env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
  }
  if (moduleName === "own-gpu" || moduleName === "finish-rife") {
    return env.BACKEND_RUNPOD_ENDPOINT_ID?.trim() || env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
  }
  return env.RUNPOD_ENDPOINT_ID?.trim() || undefined;
}

export function runpodModuleEnvFromProcess(env: NodeJS.ProcessEnv): RunpodModuleEnv {
  return {
    RUNPOD_API_KEY: env.RUNPOD_API_KEY?.trim() || undefined,
    RUNPOD_ENDPOINT_ID: env.RUNPOD_ENDPOINT_ID?.trim() || undefined,
    BACKEND_RUNPOD_ENDPOINT_ID: env.BACKEND_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    KEYFRAME_RUNPOD_ENDPOINT_ID: env.KEYFRAME_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID: env.VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    MUSETALK_RUNPOD_ENDPOINT_ID: env.MUSETALK_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: env.AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID?.trim() || undefined,
    RUNPOD_WORKERS_MAX: env.RUNPOD_WORKERS_MAX?.trim() || undefined,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_REGION: env.S3_REGION,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
  };
}

export function runpodModuleEnvFromRuntime(runtime: { asProcessEnv(): NodeJS.ProcessEnv }): RunpodModuleEnv {
  return runpodModuleEnvFromProcess(runtime.asProcessEnv());
}

export function runpodConfigured(env: RunpodModuleEnv, moduleName = ""): boolean {
  return Boolean(env.RUNPOD_API_KEY && resolveRunpodEndpointId(moduleName, env));
}

export function resolveWorkersMax(env: RunpodModuleEnv): number | null {
  const n = Number(env.RUNPOD_WORKERS_MAX);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}
