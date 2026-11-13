#!/usr/bin/env tsx
/**
 * ONE live render through a hosted gateway i2v door, using the SHIPPED runner (local#568). This SPENDS
 * money (cf-vidu-q3-turbo 5 s at 720p: about $0.30). Run it only when a paid smoke is authorized.
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=... GATEWAY_ID=... CF_AIG_TOKEN=... \
 *     npx tsx scripts/smoke-gateway-i2v.ts <door> <public-keyframe-url> <out-dir> [seconds] [resolution]
 *
 * Writes the clip and the run state under <out-dir> (a filesystem store; the clip key is printed),
 * then prints one JSON line: {door, ok, output|error, clip_path, elapsed_s, gateway_log_id}.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { aiLogId, aiRun } from "../src/platform/ai-run.js";
import { aiGatewayConfigured } from "../src/platform/ai-gateway.js";
import { GENERATE_TIMEOUT_MS, gatewayI2vEnvFromProcess } from "../src/modules/gateway-i2v/context.js";
import { gatewayI2vDoor } from "../src/modules/gateway-i2v/doors/index.js";
import { invokeGatewayI2v, pollGatewayI2v, type GatewayI2vContext } from "../src/modules/gateway-i2v/runner.js";

const [doorName, keyframeUrl, outDir, secondsArg, resolutionArg] = process.argv.slice(2);
const door = doorName ? gatewayI2vDoor(doorName) : null;
if (!door || !keyframeUrl || !outDir) {
  console.error("usage: smoke-gateway-i2v.ts <door> <public-keyframe-url> <out-dir> [seconds] [resolution]");
  process.exit(2);
}
const env = gatewayI2vEnvFromProcess(process.env);
if (!aiGatewayConfigured(env)) {
  console.error("smoke-gateway-i2v: set CLOUDFLARE_ACCOUNT_ID, GATEWAY_ID and CF_AIG_TOKEN");
  process.exit(2);
}

const agent = new Agent({ headersTimeout: GENERATE_TIMEOUT_MS, bodyTimeout: GENERATE_TIMEOUT_MS });
const longFetch = (url: string, init: RequestInit) =>
  undiciFetch(url, { ...(init as object), dispatcher: agent } as never) as unknown as Promise<Response>;

const store = new FilesystemObjectStore(outDir);
let run: Promise<void> | undefined;
const ctx: GatewayI2vContext = {
  env,
  store: store as never,
  bootId: randomUUID(),
  generate: (model, params) => aiRun(env, model, params, { fetch: longFetch }),
  fetchMedia: (url) => fetch(url),
  onRun: (p) => { run = p; },
};

const started = Date.now();
const req = {
  hook: "motion.backend",
  input: { shot_id: "smoke1", keyframe_url: keyframeUrl, prompt: "slow cinematic push in, clouds drift over the peaks", seconds: Number(secondsArg ?? 5) },
  config: { resolution: resolutionArg ?? "720p", generate_audio: false },
  context: { project: "smoke-568", job_id: "smoke-" + started },
};
const inv = await invokeGatewayI2v(ctx, door, req as never);
if (!inv.ok || !("poll" in inv)) {
  console.log(JSON.stringify({ door: door.name, ok: false, stage: "invoke", result: inv }));
  process.exit(1);
}
await run;
const out = await pollGatewayI2v(ctx, door, { poll: inv.poll });
const line: Record<string, unknown> = {
  door: door.name,
  ok: out.ok && "output" in out,
  elapsed_s: Math.round((Date.now() - started) / 1000),
  gateway_log_id: aiLogId(),
};
if (out.ok && "output" in out && out.output) {
  line.output = out.output;
  line.clip_path = join(outDir, out.output.clip_key);
} else {
  line.error = out.ok ? "still pending after the run settled" : out.error;
}
console.log(JSON.stringify(line));
process.exit(line.ok ? 0 : 1);
