export interface RunpodModuleEnv {
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_FORCE_PATH_STYLE?: string;
}

export function runpodModuleEnvFromProcess(env: NodeJS.ProcessEnv): RunpodModuleEnv {
  return {
    RUNPOD_API_KEY: env.RUNPOD_API_KEY?.trim() || undefined,
    RUNPOD_ENDPOINT_ID: env.RUNPOD_ENDPOINT_ID?.trim() || undefined,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_REGION: env.S3_REGION,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
  };
}

export function runpodConfigured(env: RunpodModuleEnv): boolean {
  return Boolean(env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID);
}
