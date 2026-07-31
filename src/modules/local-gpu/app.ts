// local#229: the local-gpu sidecar serves the GPU door and NOTHING ELSE.
//
// It used to carry a mock branch: with LOCAL_BACKEND_URL unset it wrote a 1x1 red PNG per keyframe
// and a black 320x240 clip per shot, under the manifest label "Local GPU Keyframe (SDXL on your own
// card)". `scripts/local-gpu-module-server.ts` passed the real artifact store as the mock store
// unconditionally, so that branch was live in the SHIPPED compose stack (LOCAL_BACKEND_URL is empty
// by default), not just in dev. A bare `compose up` therefore rendered a film out of fabricated
// frames and reported it COMPLETED. That is the defect Conrad hit; the fabricators are deleted.
//
// The honest replacement is the local#201 choke point, used exactly as the RunPod sidecars use it:
// `/module.json` reports `configured` from the SAME predicate the routing reads, so an
// unconfigured door self-reports `configured: false` and `filterConfiguredModules` drops it. A
// dropped module is neither visible in the panel nor submittable, and the host says WHY before a
// render starts (src/local-door-availability.ts -> host.hooks_unavailable).
//
// `configured` is computed from `localGpuConfigured` and the invoke handlers refuse on the same
// condition, so the manifest's honesty and the routing decision cannot drift apart.
import { Hono } from "hono";
import type {
  CancelRequest,
  InvokeRequest,
  KeyframeInput,
  MotionBackendInput,
  PollRequest,
} from "@skyphusion-labs/vivijure-core";
import {
  cancelLocalGpu,
  doorDurationGrid,
  invokeLocalGpu,
  invokeLocalKeyframe,
  localGpuConfigured,
  pollLocalGpu,
  pollLocalKeyframe,
  type LocalGpuEnv,
} from "./handlers.js";
import { decodeKeyframePoll } from "./keyframe-core.js";
import { decodePoll } from "./i2v-core.js";

export function createLocalGpuModuleApp(
  manifest: Record<string, unknown>,
  getEnv: () => Promise<LocalGpuEnv>,
): Hono {
  const app = new Hono();

  app.get("/module.json", async (c) => {
    const env = await getEnv();
    const configured = localGpuConfigured(env);
    // 200 in both states: the compose healthcheck curls this path, and an unconfigured door is a
    // hidden module, not a broken container.
    if (!configured) return c.json({ ...manifest, configured });
    const grid = await doorDurationGrid(env);
    return c.json({ ...manifest, ...(grid ? { duration_grid: grid } : {}), configured });
  });

  app.post("/invoke", async (c) => {
    let req: InvokeRequest;
    try {
      req = (await c.req.json()) as InvokeRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    const env = await getEnv();

    if (req.hook === "keyframe") {
      return c.json(await invokeLocalKeyframe(env, req as InvokeRequest<KeyframeInput>));
    }
    if (req.hook !== "motion.backend") {
      return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
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

    const kfSt = decodeKeyframePoll(body.poll);
    const motionSt = decodePoll(body.poll);
    if (kfSt && motionSt) {
      return c.json({ ok: false, error: "local-gpu: ambiguous poll token" });
    }
    if (kfSt) return c.json(await pollLocalKeyframe(env, body));
    if (!motionSt) return c.json({ ok: false, error: "local-gpu: bad poll token" });
    return c.json(await pollLocalGpu(env, body));
  });

  app.post("/cancel", async (c) => {
    const env = await getEnv();
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
