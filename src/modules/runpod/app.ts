import { Hono } from "hono";
import type { CancelRequest, InvokeRequest, PollRequest } from "@skyphusion-labs/vivijure-core";
import type { RunpodModuleEnv } from "./env.js";
import {
  cancelRunpodPoll,
  invokeRunpodModule,
  isRunpodModuleName,
  pollRunpodModule,
  runpodModuleSupportsPoll,
  type RunpodModuleName,
} from "./handlers.js";

export function createRunpodModuleApp(
  manifest: Record<string, unknown>,
  moduleName: string,
  getEnv: () => Promise<RunpodModuleEnv>,
): Hono {
  if (!isRunpodModuleName(moduleName)) {
    throw new Error(`unsupported RunPod module: ${moduleName}`);
  }
  const name = moduleName as RunpodModuleName;
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
    return c.json(await invokeRunpodModule(await getEnv(), name, req));
  });

  app.post("/poll", async (c) => {
    if (!runpodModuleSupportsPoll(name)) {
      return c.json({ ok: false, error: `${label} does not support /poll` });
    }
    let body: PollRequest;
    try {
      body = (await c.req.json()) as PollRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body?.poll || typeof body.poll !== "string") {
      return c.json({ ok: false, error: "poll token required" });
    }
    return c.json(await pollRunpodModule(await getEnv(), name, body));
  });

  app.post("/cancel", async (c) => {
    let body: CancelRequest;
    try {
      body = (await c.req.json()) as CancelRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body?.poll || typeof body.poll !== "string") {
      return c.json({ ok: false, error: "poll token required" });
    }
    return c.json(await cancelRunpodPoll(await getEnv(), body));
  });

  return app;
}
