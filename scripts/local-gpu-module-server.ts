#!/usr/bin/env tsx
/**
 * local-gpu module sidecar: proxies to LOCAL_BACKEND_URL (homelab GPU door).
 *
 * A DOOR IS A PRECONDITION, not a runtime branch (local#280). With LOCAL_BACKEND_URL unset this
 * process exits before it binds a port -- it does not come up and describe itself as unconfigured.
 * Compose keeps the whole lane out of the stack (`profiles: [localgpu]` + localgpu-door-gate); this
 * check makes the same invariant true when the script is run by hand, so there is no entry point that
 * yields a doorless local-gpu service.
 *
 * There is also no mock fallback: local#229 deleted the fabricators that used to fill this gap with a
 * 1x1 PNG per keyframe and a black clip per shot.
 *
 * Usage: tsx scripts/local-gpu-module-server.ts <port>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalGpuModuleApp } from "../src/modules/local-gpu/app.js";
import { localGpuConfigured, localGpuEnvFromProcess } from "../src/modules/local-gpu/handlers.js";
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

const startupEnv = await getEnv();
if (!localGpuConfigured(startupEnv)) {
  console.error(
    "local-gpu: refusing to start with no GPU door.\n" +
      "Set LOCAL_BACKEND_URL to an absolute http(s) URL (your vivijure-local-16gb / -12gb door),\n" +
      "or drop 'localgpu' from COMPOSE_PROFILES to run this studio without a GPU door.",
  );
  process.exit(1);
}

const app = createLocalGpuModuleApp(manifest, getEnv);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`local-gpu module on http://127.0.0.1:${port} (door=${startupEnv.LOCAL_BACKEND_URL})`);
});
