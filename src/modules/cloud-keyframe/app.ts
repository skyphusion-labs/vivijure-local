import { Hono } from "hono";
import type { InvokeRequest, KeyframeInput, PollRequest } from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { invokeCloudKeyframe, pollCloudKeyframe, type CloudKeyframeEnv } from "./handlers.js";

export function createCloudKeyframeModuleApp(
  manifest: Record<string, unknown>,
  store: ArtifactStore,
  getEnv: () => Promise<CloudKeyframeEnv>,
): Hono {
  const app = new Hono();

  app.get("/module.json", (c) => c.json(manifest));

  app.post("/invoke", async (c) => {
    let req: InvokeRequest<KeyframeInput>;
    try {
      req = (await c.req.json()) as InvokeRequest<KeyframeInput>;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (req.hook !== "keyframe") {
      return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
    }
    return c.json(await invokeCloudKeyframe(store, await getEnv(), req));
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
    return c.json(await pollCloudKeyframe(store, await getEnv(), body));
  });

  app.post("/cancel", (c) => c.json({ ok: false, error: "cloud-keyframe does not support /cancel" }));

  return app;
}
