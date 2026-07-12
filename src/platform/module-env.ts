import type { Platform } from "./types.js";
import { platformAsEnv } from "./types.js";

/** Build the env bag `discoverModules()` expects from a Platform (HTTP module fetchers + DB). */
export function moduleEnvFromPlatform(platform: Platform): Record<string, unknown> {
  const env = platformAsEnv(platform);
  if (platform.vars.AUTH_MODE) env.AUTH_MODE = platform.vars.AUTH_MODE;
  return env;
}
