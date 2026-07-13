#!/usr/bin/env tsx
/** Usage: tsx scripts/finish-cpu-module-server.ts <port> text-overlay */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFinishCpuModuleApp } from "../src/modules/finish-cpu/app.js";
import { finishCpuEnvFromProcess, isFinishCpuModuleName } from "../src/modules/finish-cpu/handlers.js";
import { createStorage } from "../src/platform/create-storage.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3] ?? "text-overlay";
if (!port || !isFinishCpuModuleName(moduleName)) {
  console.error("usage: finish-cpu-module-server.ts <port> text-overlay");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "dev/manifests", `${moduleName}.json`), "utf8"));

async function getEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return finishCpuEnvFromProcess(runtime.asProcessEnv());
}

const runtime = await loadModuleRuntimeEnv();
const storage = createStorage(runtime.asProcessEnv());
const app = createFinishCpuModuleApp(manifest, moduleName, getEnv, storage.renders);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`finish cpu module ${moduleName} on http://127.0.0.1:${port}`);
});
