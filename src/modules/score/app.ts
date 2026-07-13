import { Hono } from "hono";
import type { InvokeRequest, PollRequest, ScoreInput } from "@skyphusion-labs/vivijure-core";
import {
  invokeScoreModule,
  isScoreModuleName,
  pollScoreModule,
  type ScoreModuleEnv,
  type ScoreModuleName,
} from "./handlers.js";

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

  app.get("/module.json", (c) => c.json(manifest));

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
