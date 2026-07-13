#!/usr/bin/env tsx
/**
 * RunPod-backed module sidecar (keyframe, own-gpu, finish-*, cloud motion backends).
 * Falls back to GPU mock for keyframe when RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID are unset.
 *
 * Usage: tsx scripts/runpod-module-server.ts <port> <module-name>
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGpuMockModuleApp } from "../src/modules/dev/gpu-mock-app.js";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { runpodConfigured, runpodModuleEnvFromRuntime } from "../src/modules/runpod/env.js";
import { isRunpodModuleName } from "../src/modules/runpod/handlers.js";
import { createStorage } from "../src/platform/create-storage.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3];
if (!port || !moduleName) {
  console.error("usage: runpod-module-server.ts <port> <module-name>");
  process.exit(1);
}
if (!isRunpodModuleName(moduleName)) {
  console.error(`unsupported RunPod module: ${moduleName}`);
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", `${moduleName}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

async function getEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return runpodModuleEnvFromRuntime(runtime);
}

const runtime = await loadModuleRuntimeEnv();
const env = runpodModuleEnvFromRuntime(runtime);
const storage = createStorage(runtime.asProcessEnv());

let app: Hono;
if (moduleName === "keyframe") {
  const mockApp = createGpuMockModuleApp(manifest, "keyframe", storage.renders);
  const runpodApp = createRunpodModuleApp(manifest, moduleName, getEnv);
  app = new Hono();
  app.all("*", async (c) => {
    const live = await getEnv();
    const target = runpodConfigured(live, "keyframe") ? runpodApp : mockApp;
    return target.fetch(c.req.raw, c.env);
  });
} else {
  app = createRunpodModuleApp(manifest, moduleName, getEnv);
}

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  const mode =
    moduleName === "keyframe"
      ? runpodConfigured(env, "keyframe")
        ? "runpod"
        : "mock"
      : runpodConfigured(env, moduleName)
        ? "runpod"
        : "runpod-unconfigured";
  console.log(`runpod module ${moduleName} on http://127.0.0.1:${port} (${mode})`);
});
