import { Hono } from "hono";
import type { InvokeRequest, KeyframeInput, MotionBackendInput, PollRequest } from "@skyphusion-labs/vivijure-core";
import {
  invokeKeyframeMock,
  invokeLocalGpuMock,
  isGpuMockModuleName,
  pollLocalGpuMock,
  type GpuMockModuleName,
} from "./gpu-mock-handlers.js";
import type { ArtifactStore } from "../../platform/create-storage.js";

export function createGpuMockModuleApp(
  manifest: Record<string, unknown>,
  moduleName: GpuMockModuleName,
  store: ArtifactStore,
): Hono {
  const app = new Hono();
  const name = String(manifest.name ?? moduleName);

  app.get("/module.json", (c) => c.json(manifest));

  app.post("/invoke", async (c) => {
    let req: InvokeRequest;
    try {
      req = (await c.req.json()) as InvokeRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (moduleName === "keyframe") {
      if (req.hook !== "keyframe") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeKeyframeMock(store, req as InvokeRequest<KeyframeInput>));
    }
    if (req.hook !== "motion.backend") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
    return c.json(await invokeLocalGpuMock(store, req as InvokeRequest<MotionBackendInput>));
  });

  app.post("/poll", async (c) => {
    if (moduleName !== "local-gpu") {
      return c.json({ ok: false, error: `${name} does not support /poll` });
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
    return c.json(await pollLocalGpuMock(body));
  });

  app.post("/cancel", (c) => c.json({ ok: true }));

  return app;
}

export { isGpuMockModuleName };
