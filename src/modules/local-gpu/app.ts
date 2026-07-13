import { Hono } from "hono";
import type { CancelRequest, InvokeRequest, MotionBackendInput, PollRequest } from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { invokeLocalGpuMock, pollLocalGpuMock } from "../dev/gpu-mock-handlers.js";
import {
  cancelLocalGpu,
  doorDurationGrid,
  invokeLocalGpu,
  localGpuConfigured,
  pollLocalGpu,
  type LocalGpuEnv,
} from "./handlers.js";

export function createLocalGpuModuleApp(
  manifest: Record<string, unknown>,
  getEnv: () => Promise<LocalGpuEnv>,
  mockStore?: ArtifactStore,
): Hono {
  const app = new Hono();

  app.get("/module.json", async (c) => {
    const env = await getEnv();
    const useMock = !localGpuConfigured(env) && mockStore != null;
    if (useMock) return c.json(manifest);
    const grid = await doorDurationGrid(env);
    return c.json(grid ? { ...manifest, duration_grid: grid } : manifest);
  });

  app.post("/invoke", async (c) => {
    let req: InvokeRequest;
    try {
      req = (await c.req.json()) as InvokeRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (req.hook !== "motion.backend") {
      return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
    }
    const env = await getEnv();
    const useMock = !localGpuConfigured(env) && mockStore != null;
    if (useMock && mockStore) {
      return c.json(await invokeLocalGpuMock(mockStore, req as InvokeRequest<MotionBackendInput>));
    }
    return c.json(await invokeLocalGpu(env, req as InvokeRequest<MotionBackendInput>));
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
    const env = await getEnv();
    const useMock = !localGpuConfigured(env) && mockStore != null;
    if (useMock) return c.json(await pollLocalGpuMock(body));
    return c.json(await pollLocalGpu(env, body));
  });

  app.post("/cancel", async (c) => {
    const env = await getEnv();
    const useMock = !localGpuConfigured(env) && mockStore != null;
    if (useMock) return c.json({ ok: true });
    let body: CancelRequest;
    try {
      body = (await c.req.json()) as CancelRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body?.poll || typeof body.poll !== "string") {
      return c.json({ ok: false, error: "poll token required" });
    }
    return c.json(await cancelLocalGpu(env, body));
  });

  return app;
}
