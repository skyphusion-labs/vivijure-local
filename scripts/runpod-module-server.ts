#!/usr/bin/env tsx
/**
 * RunPod-backed module sidecar (keyframe, own-gpu, finish-*, cloud motion backends).
 * Falls back to GPU mock for keyframe when RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID are unset; the mock
 * never answers /module.json, so an uncredentialed keyframe module reports configured:false and the
 * panel hides it (local#223). See src/modules/runpod/keyframe-sidecar.ts.
 *
 * Usage: tsx scripts/runpod-module-server.ts <port> <module-name>
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { runpodModuleEnvFromRuntime } from "../src/modules/runpod/env.js";
import { isRunpodModuleName, runpodModuleConfigured } from "../src/modules/runpod/handlers.js";
import { createKeyframeSidecarApp } from "../src/modules/runpod/keyframe-sidecar.js";
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

const app: Hono =
  moduleName === "keyframe"
    ? createKeyframeSidecarApp(manifest, getEnv, storage.renders)
    : createRunpodModuleApp(manifest, moduleName, getEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  // The unconfigured keyframe mock is now HIDDEN from the panel (local#223): it stays reachable as a
  // direct dev affordance, so say both halves rather than a bare "(mock)".
  const mode = runpodModuleConfigured(env, moduleName)
    ? "runpod"
    : moduleName === "keyframe"
      ? "mock; hidden from the panel until RunPod creds are set"
      : "runpod-unconfigured";
  console.log(`runpod module ${moduleName} on http://127.0.0.1:${port} (${mode})`);
});
