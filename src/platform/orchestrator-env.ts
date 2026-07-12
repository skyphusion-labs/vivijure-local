import type { Platform } from "./types.js";
import { platformAsEnv } from "./types.js";
import { wrapR2Bucket } from "./r2-adapter.js";
import type { OrchestratorEnv } from "../orchestrator-env.js";

/** Build the env bag film/render orchestrators expect from a Platform. */
export function orchestratorEnvFromPlatform(platform: Platform): OrchestratorEnv {
  const base = platformAsEnv(platform);
  const env = base as OrchestratorEnv;
  env.DB = platform.db;
  env.R2_RENDERS = wrapR2Bucket(platform.renders);
  env.R2 = wrapR2Bucket(platform.chatBucket);
  env.PRESIGNER = platform.presigner;
  if (platform.vars.AUTH_MODE) env.AUTH_MODE = platform.vars.AUTH_MODE;
  return env;
}
