#!/usr/bin/env tsx
/**
 * local-gpu module sidecar: proxies to LOCAL_BACKEND_URL (homelab GPU backend).
 * Falls back to GPU mock when LOCAL_BACKEND_URL is unset (offline compose default).
 *
 * Usage: tsx scripts/local-gpu-module-server.ts <port>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalGpuModuleApp } from "../src/modules/local-gpu/app.js";
import { localGpuEnvFromProcess } from "../src/modules/local-gpu/handlers.js";
import { createStorage } from "../src/platform/create-storage.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
if (!port) {
  console.error("usage: local-gpu-module-server.ts <port>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", "local-gpu.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

async function getEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return localGpuEnvFromProcess(runtime.asProcessEnv());
}

const runtime = await loadModuleRuntimeEnv();
const storage = createStorage(runtime.asProcessEnv());
const app = createLocalGpuModuleApp(manifest, getEnv, storage.renders);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, async () => {
  const env = await getEnv();
  const mode = env.LOCAL_BACKEND_URL?.trim() ? "backend=configured" : "mock";
  console.log(`local-gpu module on http://127.0.0.1:${port} (${mode})`);
});
