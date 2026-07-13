#!/usr/bin/env tsx
/** Usage: tsx scripts/cloud-keyframe-module-server.ts <port> */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCloudKeyframeModuleApp } from "../src/modules/cloud-keyframe/app.js";
import { createStorage } from "../src/platform/create-storage.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
if (!port) {
  console.error("usage: cloud-keyframe-module-server.ts <port>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "dev/manifests", "cloud-keyframe.json"), "utf8"),
) as Record<string, unknown>;

import { cloudKeyframeEnvFromRuntime } from "../src/modules/cloud-keyframe/handlers.js";

async function getEnv() {
  const runtime = await loadModuleRuntimeEnv();
  return cloudKeyframeEnvFromRuntime(runtime);
}

const runtime = await loadModuleRuntimeEnv();
const storage = createStorage(runtime.asProcessEnv());
const app = createCloudKeyframeModuleApp(manifest, storage.renders, getEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`cloud-keyframe module on http://127.0.0.1:${port}`);
});
