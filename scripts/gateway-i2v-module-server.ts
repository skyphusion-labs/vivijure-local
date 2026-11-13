#!/usr/bin/env tsx
/**
 * Hosted (Cloudflare AI Gateway) image-to-video door sidecar, local#568. One process per door.
 *
 * OPT-IN cloud: with the gateway creds unset the sidecar reports `configured: false` on /module.json and
 * the panel hides it (local#201). Ported doors: src/modules/gateway-i2v/doors/.
 *
 * Usage: tsx scripts/gateway-i2v-module-server.ts <port> <door-name>
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGatewayI2vApp } from "../src/modules/gateway-i2v/app.js";
import { gatewayI2vContext } from "../src/modules/gateway-i2v/context.js";
import { gatewayI2vDoor } from "../src/modules/gateway-i2v/doors/index.js";
import { aiGatewayConfigured } from "../src/platform/ai-gateway.js";
import { loadModuleRuntimeEnv } from "../src/platform/module-runtime-env.js";

const port = Number(process.argv[2]);
const doorName = process.argv[3];
const door = doorName ? gatewayI2vDoor(doorName) : null;
if (!port || !door) {
  console.error("usage: gateway-i2v-module-server.ts <port> <door-name>");
  process.exit(1);
}

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "dev/manifests", `${door.name}.json`), "utf8")) as Record<string, unknown>;

async function getContext() {
  const runtime = await loadModuleRuntimeEnv();
  return gatewayI2vContext(runtime.asProcessEnv());
}

const app = createGatewayI2vApp(manifest, door, getContext);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, async () => {
  const { env } = await getContext();
  const mode = aiGatewayConfigured(env) ? "ai gateway" : "hidden from the panel until the AI Gateway creds are set";
  console.log(`gateway i2v door ${door.name} on http://127.0.0.1:${port} (${mode})`);
});
