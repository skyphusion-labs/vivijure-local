#!/usr/bin/env tsx
/**
 * CPU module sidecar: manifest + real /invoke (and /poll for film.finish modules).
 *
 * Usage: tsx scripts/cpu-module-server.ts <port> <module-name>
 * Manifest: dev/manifests/<module-name>.json
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCpuModuleApp } from "../src/modules/cpu/app.js";
import { isCpuModuleName } from "../src/modules/cpu/handlers.js";
import { cpuModuleEnvFromProcess } from "../src/modules/cpu/vpc-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3];
if (!port || !moduleName) {
  console.error("usage: cpu-module-server.ts <port> <module-name>");
  process.exit(1);
}
if (!isCpuModuleName(moduleName)) {
  console.error(`unsupported CPU module: ${moduleName}`);
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifestPath = join(repoRoot, "dev/manifests", `${moduleName}.json`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
const env = cpuModuleEnvFromProcess(process.env);
const app = createCpuModuleApp(manifest, moduleName, env);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`cpu module sidecar ${moduleName} on http://127.0.0.1:${port}`);
});
