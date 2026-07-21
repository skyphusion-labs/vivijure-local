// Hot-reload platform bindings after the operator saves connection settings from the GUI.

import type { Platform } from "./types.js";
import { createModuleTransport } from "./modules.js";
import { createStorage } from "./create-storage.js";
import { RuntimeSecretStore } from "./runtime-secrets.js";
import type { RuntimeEnv } from "./runtime-env.js";
import { buildVpcHostBindings } from "./vpc-transport.js";

export interface PlatformReloadResult {
  restart_recommended: boolean;
  applied_immediate: string[];
  applied_restart: string[];
}

export function applyRuntimeEnvToPlatform(
  platform: Platform,
  runtime: RuntimeEnv,
  opts: { publicBase: string },
): PlatformReloadResult {
  const env = runtime.asProcessEnv();
  const storage = createStorage(env, {
    publicBase: opts.publicBase,
    token: runtime.get("STUDIO_API_TOKEN"),
  });

  platform.renders = storage.renders;
  platform.chatBucket = storage.chatBucket;
  platform.presigner = storage.presigner;
  platform.modules = createModuleTransport(env);
  platform.secrets = new RuntimeSecretStore(runtime);
  platform.vars = {
    ...platform.vars,
    AUTH_MODE: runtime.get("AUTH_MODE") ?? platform.vars.AUTH_MODE,
    STUDIO_API_TOKEN: runtime.get("STUDIO_API_TOKEN"),
    ALLOW_UNAUTHENTICATED: runtime.get("ALLOW_UNAUTHENTICATED"),
    PUBLIC_BASE_URL: opts.publicBase,
    PLANNER_AI_MOCK: runtime.get("PLANNER_AI_MOCK") ?? "false",
    CLOUDFLARE_ACCOUNT_ID: runtime.get("CLOUDFLARE_ACCOUNT_ID"),
    GATEWAY_ID: runtime.get("GATEWAY_ID"),
    CF_AIG_TOKEN: runtime.get("CF_AIG_TOKEN"),
    ANTHROPIC_API_KEY: runtime.get("ANTHROPIC_API_KEY"),
    RUNPOD_API_KEY: runtime.get("RUNPOD_API_KEY"),
    RUNPOD_ENDPOINT_ID: runtime.get("RUNPOD_ENDPOINT_ID"),
    BACKEND_RUNPOD_ENDPOINT_ID: runtime.get("BACKEND_RUNPOD_ENDPOINT_ID"),
    KEYFRAME_RUNPOD_ENDPOINT_ID: runtime.get("KEYFRAME_RUNPOD_ENDPOINT_ID"),
    RUNPOD_WAN_TRAIN_ENDPOINT_ID: runtime.get("RUNPOD_WAN_TRAIN_ENDPOINT_ID"),
    VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID: runtime.get("VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID"),
    MUSETALK_RUNPOD_ENDPOINT_ID: runtime.get("MUSETALK_RUNPOD_ENDPOINT_ID"),
    AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: runtime.get("AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID"),
    STORAGE_BACKEND: storage.backend,
  };

  platform.hostBindings = buildVpcHostBindings(env);

  return {
    restart_recommended: false,
    applied_immediate: [],
    applied_restart: [],
  };
}

export function maskSecretValue(value: string, sensitive: boolean): string {
  if (!value) return "";
  if (!sensitive) return value;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
