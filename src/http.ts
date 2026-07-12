import type { Platform } from "./platform/types.js";
import type { AuthEnv } from "./env.js";

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function authEnvFromPlatform(platform: Platform): AuthEnv {
  return {
    AUTH_MODE: platform.vars.AUTH_MODE,
    STUDIO_API_TOKEN: platform.vars.STUDIO_API_TOKEN,
    ALLOW_UNAUTHENTICATED: platform.vars.ALLOW_UNAUTHENTICATED,
    DB: platform.db,
  };
}
