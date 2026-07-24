import { Hono } from "hono";
import type { InvokeRequest, PollRequest, ScoreInput } from "@skyphusion-labs/vivijure-core";
import { aiGatewayConfigured } from "../../platform/ai-gateway.js";
import {
  invokeScoreModule,
  isScoreModuleName,
  pollScoreModule,
  type ScoreModuleEnv,
  type ScoreModuleName,
} from "./handlers.js";
import { narrationEngineFor, narrationManifestView } from "./narration-aura.js";

export function createScoreModuleApp(
  manifest: Record<string, unknown>,
  moduleName: string,
  getEnv: () => Promise<ScoreModuleEnv>,
): Hono {
  if (!isScoreModuleName(moduleName)) {
    throw new Error(`unsupported score module: ${moduleName}`);
  }
  const name = moduleName as ScoreModuleName;
  const app = new Hono();
  const label = String(manifest.name ?? moduleName);

  // local#202: narration-gen serves an engine-honest runtime manifest (active tier + honest label);
  // the committed manifest stays cf-canonical (drift-locked), so upstream parity is untouched.
  app.get("/module.json", async (c) => {
    if (name !== "narration-gen") return c.json(manifest);
    const env = await getEnv();
    const engine = narrationEngineFor(Boolean(env.RUNPOD_API_KEY?.trim()), aiGatewayConfigured(env));
    return c.json(narrationManifestView(manifest, engine));
  });

  app.post("/invoke", async (c) => {
    let req: InvokeRequest;
    try {
      req = (await c.req.json()) as InvokeRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    return c.json(await invokeScoreModule(await getEnv(), name, req as InvokeRequest<ScoreInput>));
  });

  app.post("/poll", async (c) => {
    let body: PollRequest;
    try {
      body = (await c.req.json()) as PollRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body?.poll || typeof body.poll !== "string") {
      return c.json({ ok: false, error: "poll token required" });
    }
    return c.json(await pollScoreModule(await getEnv(), name, body));
  });

  app.post("/cancel", (c) => c.json({ ok: false, error: `${label} does not support /cancel` }));

  return app;
}
