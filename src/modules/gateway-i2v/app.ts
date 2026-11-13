// local#568: the hosted gateway i2v door sidecar app (same routes as the cf Worker:
// GET /module.json, GET /ready, POST /invoke, POST /poll).
import { Hono } from "hono";
import type { InvokeRequest, MotionBackendInput, PollRequest } from "@skyphusion-labs/vivijure-core/modules/types";
import { aiGatewayConfigured } from "../../platform/ai-gateway.js";
import type { GatewayI2vDoor } from "./door.js";
import { invokeGatewayI2v, pollGatewayI2v, type GatewayI2vContext } from "./runner.js";

export function createGatewayI2vApp(
  manifest: Record<string, unknown>,
  door: GatewayI2vDoor<unknown>,
  getContext: () => Promise<GatewayI2vContext>,
): Hono {
  const app = new Hono();

  // local#201 mechanism: hidden from discoverConfiguredModules until the gateway creds are set.
  app.get("/module.json", async (c) => {
    const { env } = await getContext();
    return c.json({ ...manifest, configured: aiGatewayConfigured(env) });
  });

  app.get("/ready", async (c) => {
    const { env } = await getContext();
    const ok = aiGatewayConfigured(env);
    return c.json({ ok, module: door.name, credentials: { gateway: ok } });
  });

  app.post("/invoke", async (c) => {
    let req: InvokeRequest<MotionBackendInput>;
    try {
      req = (await c.req.json()) as InvokeRequest<MotionBackendInput>;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body", reason: "bad-input" });
    }
    if (req.hook !== "motion.backend") {
      return c.json({ ok: false, error: "unsupported hook " + String(req.hook), reason: "unsupported" });
    }
    return c.json(await invokeGatewayI2v(await getContext(), door, req));
  });

  app.post("/poll", async (c) => {
    let body: PollRequest;
    try {
      body = (await c.req.json()) as PollRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body || typeof body.poll !== "string") return c.json({ ok: false, error: "poll token required" });
    return c.json(await pollGatewayI2v(await getContext(), door, body));
  });

  app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));
  return app;
}
