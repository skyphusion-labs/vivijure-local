import "dotenv/config";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { sweepUnresolvedJobs } from "@skyphusion-labs/vivijure-core/render-sweep";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import { createApp, repoRoot } from "./app.js";
import {
  createModuleTransport,
  createStorage,
  migrateDatabase,
  openDatabase,
  RuntimeSecretStore,
  type Platform,
} from "./platform/index.js";
import { RuntimeEnv } from "./platform/runtime-env.js";
import { applyRuntimeEnvToPlatform } from "./platform/reload.js";
import type { SettingsHost } from "./routes/m8-settings.js";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export interface StudioBoot {
  platform: Platform;
  runtime: RuntimeEnv;
  publicBase: string;
  settingsHost: SettingsHost;
}

export async function buildStudio(): Promise<StudioBoot> {
  const dbPath = env("DATABASE_PATH", join(repoRoot, "data", "studio.db"))!;
  const port = env("PORT", "8790")!;
  const publicBase = env("PUBLIC_BASE_URL", `http://127.0.0.1:${port}`)!;

  migrateDatabase(dbPath, join(repoRoot, "migrations"));

  const db = openDatabase(dbPath);
  const { bootstrapPlatformSecretsFromEnv } = await import("./platform-secrets-bootstrap.js");
  await bootstrapPlatformSecretsFromEnv(db, process.env);

  const runtime = await RuntimeEnv.load(process.env, db);

  const storage = createStorage(runtime.asProcessEnv(), {
    publicBase,
    token: runtime.get("STUDIO_API_TOKEN"),
  });

  const platform: Platform = {
    db,
    renders: storage.renders,
    chatBucket: storage.chatBucket,
    presigner: storage.presigner,
    secrets: new RuntimeSecretStore(runtime),
    modules: createModuleTransport(runtime.asProcessEnv()),
    vars: {
      AUTH_MODE: env("AUTH_MODE", "token"),
      STUDIO_API_TOKEN: runtime.get("STUDIO_API_TOKEN"),
      ALLOW_UNAUTHENTICATED: runtime.get("ALLOW_UNAUTHENTICATED"),
      PUBLIC_BASE_URL: publicBase,
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
    },
  };

  applyRuntimeEnvToPlatform(platform, runtime, { publicBase });

  const settingsHost: SettingsHost = { platform, runtime, publicBase };
  return { platform, runtime, publicBase, settingsHost };
}

const boot = await buildStudio();
export const platform = boot.platform;
export const app = createApp(boot.settingsHost);

const SWEEP_INTERVAL_MS = 60_000;
let sweepInFlight = false;

function startRenderSweep(): void {
  if (process.env.RENDER_SWEEP_ENABLED === "false") {
    console.log("  render-sweep: disabled (RENDER_SWEEP_ENABLED=false)");
    return;
  }
  const tick = async (): Promise<void> => {
    if (sweepInFlight) return;
    sweepInFlight = true;
    try {
      const env = orchestratorContextFromPlatform(platform);
      const n = await sweepUnresolvedJobs(env);
      if (n > 0) console.log(`render-sweep: advanced ${n} job(s)`);
    } catch (e) {
      console.warn(`render-sweep failed: ${(e as Error).message}`);
    } finally {
      sweepInFlight = false;
    }
  };
  void tick();
  setInterval(() => void tick(), SWEEP_INTERVAL_MS);
}

const port = Number(env("PORT", "8790"));
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`vivijure-local listening on http://127.0.0.1:${info.port}`);
  console.log(`  AUTH_MODE=${platform.vars.AUTH_MODE}`);
  console.log(`  storage=${platform.vars.STORAGE_BACKEND || "unknown"}`);
  console.log(`  modules bound: ${platform.modules.listBindings().join(", ") || "(none)"}`);
  console.log(`  operator settings: ${boot.publicBase}/settings`);
  startRenderSweep();
});

export { boot };
