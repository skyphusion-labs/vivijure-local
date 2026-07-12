import type { Platform } from "./types.js";
import { platformAsEnv } from "./types.js";
import { wrapR2Bucket } from "./r2-adapter.js";
import { injectVpcFetchers } from "./vpc-transport.js";
import type { OrchestratorEnv } from "../orchestrator-env.js";

/** Build the env bag film/render orchestrators expect from a Platform. */
export function orchestratorEnvFromPlatform(platform: Platform): OrchestratorEnv {
  const base = platformAsEnv(platform);
  const env = base as OrchestratorEnv;
  env.DB = platform.db;
  env.R2_RENDERS = wrapR2Bucket(platform.renders);
  env.R2 = wrapR2Bucket(platform.chatBucket);
  env.PRESIGNER = platform.presigner;
  injectVpcFetchers(env, process.env);
  for (const [key, value] of Object.entries(platform.vars)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
