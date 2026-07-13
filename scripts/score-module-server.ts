#!/usr/bin/env tsx
/** Usage: tsx scripts/score-module-server.ts <port> <music-gen|narration-gen> */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScoreModuleApp } from "../src/modules/score/app.js";
import { isScoreModuleName, scoreModuleEnvFromRuntime } from "../src/modules/score/handlers.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const moduleName = process.argv[3];
if (!port || !moduleName || !isScoreModuleName(moduleName)) {
  console.error("usage: score-module-server.ts <port> <music-gen|narration-gen>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "dev/manifests", `${moduleName}.json`), "utf8"));

async function getEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return scoreModuleEnvFromRuntime(runtime);
}

const app = createScoreModuleApp(manifest, moduleName, getEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`score module ${moduleName} on http://127.0.0.1:${port}`);
});
