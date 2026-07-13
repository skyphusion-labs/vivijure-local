import { Hono } from "hono";
import type { FinishInput, InvokeRequest } from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import type { FinishCpuEnv } from "./handlers.js";
import { invokeTextOverlay, isFinishCpuModuleName } from "./handlers.js";

export function createFinishCpuModuleApp(
  manifest: Record<string, unknown>,
  moduleName: string,
  getEnv: () => Promise<FinishCpuEnv>,
  store: ArtifactStore,
): Hono {
  if (!isFinishCpuModuleName(moduleName)) {
    throw new Error(`unsupported finish CPU module: ${moduleName}`);
  }
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
    if (req.hook !== "finish") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
    return c.json(await invokeTextOverlay(await getEnv(), store, req as InvokeRequest<FinishInput>));
  });

  app.post("/poll", (c) => c.json({ ok: false, error: `${label} does not support /poll` }));
  app.post("/cancel", (c) => c.json({ ok: false, error: `${label} does not support /cancel` }));

  return app;
}
