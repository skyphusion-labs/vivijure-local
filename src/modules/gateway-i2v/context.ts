// local#568: the production context for a gateway i2v sidecar.
import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import { createStorage } from "../../platform/create-storage.js";
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { aiRun } from "../../platform/ai-run.js";
import type { GatewayI2vContext } from "./runner.js";

/** cf's generate step timeout is 25 minutes. Node's fetch gives up on headers after 300 s, which a slow
 *  video generation outlives, so the provider call runs on its own Agent with the cf ceiling. */
export const GENERATE_TIMEOUT_MS = 25 * 60_000;

const longAgent = new Agent({ headersTimeout: GENERATE_TIMEOUT_MS, bodyTimeout: GENERATE_TIMEOUT_MS });

const longFetch = (url: string, init: RequestInit): Promise<Response> =>
  undiciFetch(url, { ...(init as object), dispatcher: longAgent } as never) as unknown as Promise<Response>;

/** One id per process: a `running` state from another boot is a restart orphan (runner.ts). */
export const BOOT_ID = randomUUID();

export function gatewayI2vEnvFromProcess(env: NodeJS.ProcessEnv): AiGatewayEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined,
    GATEWAY_ID: env.GATEWAY_ID?.trim() || undefined,
    CF_AIG_TOKEN: env.CF_AIG_TOKEN?.trim() || undefined,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN?.trim() || undefined,
  };
}

export function gatewayI2vContext(processEnv: NodeJS.ProcessEnv): GatewayI2vContext {
  const env = gatewayI2vEnvFromProcess(processEnv);
  const store = createStorage(processEnv).renders;
  return {
    env,
    store,
    bootId: BOOT_ID,
    generate: (model, params) => aiRun(env, model, params, { fetch: longFetch }),
    fetchMedia: (url) => fetch(url),
  };
}
