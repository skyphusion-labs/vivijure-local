import { Hono } from "hono";
import type { CancelRequest, InvokeRequest, PollRequest } from "@skyphusion-labs/vivijure-core";
import type { RunpodModuleEnv } from "./env.js";
import {
  cancelRunpodPoll,
  invokeRunpodModule,
  isRunpodModuleName,
  pollRunpodModule,
  runpodModuleConfigured,
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

  // local#201: advertise whether this RunPod module has its creds. configured:false makes the panel
  // hide it (see src/module-registry.ts), so an uncredentialed RunPod module is never a broken button.
  app.get("/module.json", async (c) => {
    const configured = runpodModuleConfigured(await getEnv(), name);
    return c.json({ ...manifest, configured });
  });

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
