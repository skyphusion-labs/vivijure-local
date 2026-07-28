// The local-gpu sidecar serves the GPU door and NOTHING ELSE.
//
// local#229 deleted the mock branch that made this sidecar fabricate frames (a 1x1 red PNG per
// keyframe, a black 320x240 clip per shot) whenever LOCAL_BACKEND_URL was empty -- which was the
// default in the shipped compose stack, so a bare `compose up` delivered a film assembled from
// placeholders and reported it COMPLETED.
//
// local#280 removed the SECOND thing this file was doing: reporting `configured: false` about itself.
// That was a process kept alive to announce its own absence, and it existed because the compose
// healthcheck curled /module.json and so the container had to stay up. Conrad's ruling: "We shouldn't
// have to build a shim for a module that isn't even there." The stack answers this now -- the module
// lives in the `localgpu` compose profile, so with no door there is no container, no manifest, and no
// binding for the studio to discover. Absence needs no representative.
//
// So this app assumes a door: it is only ever constructed by a sidecar that has already refused to
// start without LOCAL_BACKEND_URL (scripts/local-gpu-module-server.ts). /module.json describes the
// module, and a failing healthcheck means a genuinely broken container rather than a hidden one.
//
// The `not configured` guards in handlers.ts stay. They are ordinary argument validation, identical
// in form to every other module in this repo (runpod, cpu, cloud-keyframe, score), and they are not
// a stand-in for anything: without them an empty base URL becomes an opaque fetch throw instead of a
// named error. They are unreachable through the compose lane, which is the point.
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
    // No `configured` field: this module is either installed (the localgpu lane is on and a door
    // answered) or it is not in the stack. There is no third state for it to self-report.
    const grid = await doorDurationGrid(env);
    return c.json({ ...manifest, ...(grid ? { duration_grid: grid } : {}) });
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
