#!/usr/bin/env tsx
/**
 * RunPod-backed module sidecar (keyframe, own-gpu, finish-*, cloud motion backends).
 *
 * Every module here is OPT-IN cloud: with RUNPOD_API_KEY / the endpoint id unset the sidecar reports
 * `configured: false` on /module.json and the panel hides it (local#201). There is no mock fallback
 * on any path -- the keyframe mock composition was deleted in local#229, so an uncredentialed
 * keyframe module refuses instead of fabricating frames.
 *
 * Usage: tsx scripts/runpod-module-server.ts <port> <module-name>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { runpodModuleEnvFromRuntime } from "../src/modules/runpod/env.js";
import { isRunpodModuleName, runpodModuleConfigured } from "../src/modules/runpod/handlers.js";
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

const app = createRunpodModuleApp(manifest, moduleName, getEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  const mode = runpodModuleConfigured(env, moduleName)
    ? "runpod"
    : "hidden from the panel until RunPod creds are set";
  console.log(`runpod module ${moduleName} on http://127.0.0.1:${port} (${mode})`);
});
