import { Hono } from "hono";
import type { FinishInput, InvokeRequest, PollRequest } from "@skyphusion-labs/vivijure-core";
import {
  localFinishConfigured,
  resolveFinishBackend,
  type FinishBackendEnv,
} from "../finish-backend.js";
import {
  invokeLocalFinish,
  pollLocalFinish,
  type LocalFinishModuleName,
} from "./handlers.js";

export function createLocalFinishModuleApp(
  manifest: Record<string, unknown>,
  moduleName: LocalFinishModuleName,
  getEnv: () => Promise<FinishBackendEnv>,
): Hono {
  const app = new Hono();
  const action = moduleName === "finish-lipsync" ? ("lipsync_clip" as const) : ("upscale_clip" as const);
  // local#377: the upscale door's sizing contract is `target_height` and NO `scale`. vivijure-upscale
  // honours it from the 1.1.3-serve image (its PR #109) and refuses when both knobs disagree; older
  // images ignored it and returned a blind 2x. Guarded on the wire by tests/upscale-target-height-377.
  const extra = moduleName === "finish-upscale" ? { target_height: 1080 } : undefined;

  app.get("/module.json", async (c) => {
    const env = await getEnv();
    const mode = resolveFinishBackend(moduleName, env);
    const configured = mode === "local" && localFinishConfigured(moduleName, env);
    return c.json({ ...manifest, finish_backend: mode, local_finish_configured: configured });
  });

  app.post("/invoke", async (c) => {
    let req: InvokeRequest<FinishInput>;
    try {
      req = (await c.req.json()) as InvokeRequest<FinishInput>;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    return c.json(await invokeLocalFinish(await getEnv(), moduleName, action, req, extra));
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
    return c.json(await pollLocalFinish(await getEnv(), moduleName, body));
  });

  return app;
}
