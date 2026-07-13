#!/usr/bin/env tsx
/**
 * Chain module sidecar: plan.enhance, cast.image, dialogue, speech, notify.
 *
 * Usage: tsx scripts/chain-module-server.ts <port> <module-name>
 * Manifest: dev/manifests/<module-name>.json
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChainModuleApp } from "../src/modules/chain/app.js";
import { chainModuleEnvFromRuntime } from "../src/modules/chain/chain-env.js";
import { isChainModuleName } from "../src/modules/chain/handlers.js";
import { createStorage } from "../src/platform/create-storage.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3];
if (!port || !moduleName) {
  console.error("usage: chain-module-server.ts <port> <module-name>");
  process.exit(1);
}
if (!isChainModuleName(moduleName)) {
  console.error(`unsupported chain module: ${moduleName}`);
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", `${moduleName}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

async function getContext() {
  const runtime = await loadModuleRuntimeEnv();
  const storage = createStorage(runtime.asProcessEnv());
  return { env: chainModuleEnvFromRuntime(runtime), store: storage.renders };
}

const app = createChainModuleApp(manifest, moduleName, getContext);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, async () => {
  const runtime = await loadModuleRuntimeEnv();
  const storage = createStorage(runtime.asProcessEnv());
  console.log(`chain module ${moduleName} on http://127.0.0.1:${port} (storage=${storage.backend})`);
});
