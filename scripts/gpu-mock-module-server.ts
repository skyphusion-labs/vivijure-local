#!/usr/bin/env tsx
/**
 * Dev GPU mock module sidecar (keyframe + local-gpu). Writes placeholder PNG/MP4
 * artifacts to the configured object store so compose can run a full film without
 * RunPod or a host GPU backend.
 *
 * Usage: tsx scripts/gpu-mock-module-server.ts <port> <keyframe|local-gpu>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGpuMockModuleApp } from "../src/modules/dev/gpu-mock-app.js";
import { isGpuMockModuleName } from "../src/modules/dev/gpu-mock-handlers.js";
import { createStorage } from "../src/platform/create-storage.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3];
if (!port || !moduleName) {
  console.error("usage: gpu-mock-module-server.ts <port> <keyframe|local-gpu>");
  process.exit(1);
}
if (!isGpuMockModuleName(moduleName)) {
  console.error(`unsupported GPU mock module: ${moduleName}`);
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", `${moduleName}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
const storage = createStorage(process.env);
const app = createGpuMockModuleApp(manifest, moduleName, storage.renders);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`gpu mock module ${moduleName} on http://127.0.0.1:${port} (storage=${storage.backend})`);
});
