#!/usr/bin/env tsx
/**
 * Finish module sidecar: FINISH_BACKEND=local -> LOCAL_FINISH_*_URL; runpod -> RunPod API.
 *
 * Usage: tsx scripts/finish-module-server.ts <port> <finish-rife|finish-lipsync|finish-upscale>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finishBackendFromProcess, localFinishConfigured, resolveFinishBackend } from "../src/modules/finish-backend.js";
import { createLocalFinishModuleApp } from "../src/modules/local-finish/app.js";
import type { LocalFinishModuleName } from "../src/modules/local-finish/handlers.js";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { runpodConfigured, runpodModuleEnvFromRuntime } from "../src/modules/runpod/env.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3] as LocalFinishModuleName;
const FINISH_MODULES = new Set<LocalFinishModuleName>(["finish-rife", "finish-lipsync", "finish-upscale"]);

if (!port || !moduleName || !FINISH_MODULES.has(moduleName)) {
  console.error("usage: finish-module-server.ts <port> <finish-rife|finish-lipsync|finish-upscale>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", `${moduleName}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

async function getFinishEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return finishBackendFromProcess(runtime.asProcessEnv());
}

async function getRunpodEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return runpodModuleEnvFromRuntime(runtime);
}

const runtime = await loadModuleRuntimeEnv();
const finishEnv = finishBackendFromProcess(runtime.asProcessEnv());
const backend = resolveFinishBackend(moduleName, finishEnv);

const app =
  backend === "local"
    ? createLocalFinishModuleApp(manifest, moduleName, getFinishEnv)
    : createRunpodModuleApp(manifest, moduleName, getRunpodEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  const runpodEnv = runpodModuleEnvFromRuntime(runtime);
  const mode =
    backend === "local"
      ? localFinishConfigured(moduleName, finishEnv)
        ? "local"
        : "local-unconfigured"
      : runpodConfigured(runpodEnv, moduleName)
        ? "runpod"
        : "runpod-unconfigured";
  console.log(`finish module ${moduleName} on http://127.0.0.1:${port} (${mode})`);
});
