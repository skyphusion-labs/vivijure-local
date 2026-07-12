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
import { localGpuConfigured, localGpuEnvFromProcess } from "../src/modules/local-gpu/handlers.js";
import { createStorage } from "../src/platform/create-storage.js";

const port = Number(process.argv[2]);
if (!port) {
  console.error("usage: local-gpu-module-server.ts <port>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", "local-gpu.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
const env = localGpuEnvFromProcess(process.env);
const storage = createStorage(process.env);
const useMock = !localGpuConfigured(env);
const app = createLocalGpuModuleApp(manifest, env, useMock ? storage.renders : undefined);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  const mode = useMock ? "mock" : `backend=${env.LOCAL_BACKEND_URL}`;
  console.log(`local-gpu module on http://127.0.0.1:${port} (${mode})`);
});
