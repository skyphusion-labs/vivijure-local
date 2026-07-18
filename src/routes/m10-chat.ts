// M10 routes: POST /api/chat (text + image), GET /api/models (the CANONICAL full catalog).

import type { Hono } from "hono";
import { discoverModules } from "@skyphusion-labs/vivijure-core";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import { chatComplete, type ChatCompleteArgs } from "../planner.js";
import type { ChatImageArgs } from "../chat-image-module.js";
import { imageModelsFromModules, resolveCatalogTarget } from "../module-catalog.js";
import { chatImageViaModule } from "../chat-image-module.js";
import { planningModelsFromModules } from "../planning-models.js";
import { authEnvFromPlatform } from "../http.js";
import { isDemoMode } from "../auth-gate.js";
import type { SettingsHost } from "./m8-settings.js";
import { moduleEnvFromPlatform } from "../platform/module-env.js";

export function registerM10Routes(app: Hono, host: SettingsHost): void {
  const platform = host.platform;

  // GET /api/models -- the CANONICAL full catalog, identical in shape and envelope to the cf host
  // (cf#129). Serves the PROJECTED planning rows (from installed plan.enhance modules) plus the
  // image rows, so a client can read one endpoint and filter on row.type.
  //
  // This route previously served the image rows ALONE, which made the two hosts disagree about what
  // /api/models means: cf answered with the full catalog and local with an image-only subset.
  //
  // /api/storyboard/models (m7.ts) stays as the FILTERED VIEW of the same projection and remains the
  // planner picker's endpoint. It is not a second catalog; the agreement test pins the two together.
  //
  // Envelope {models:[...]} is deliberately stable: cf#129 phase 2 swaps the image rows from the
  // hardcoded list to a module projection, and that must be invisible to every consumer. An empty
  // planning list is a legitimate, honest answer -- never a 404, never a hardcoded backfill.
  app.get("/api/models", async (c) => {
    if (isDemoMode(authEnvFromPlatform(platform))) {
      return c.json({ models: [] });
    }
    const modEnv = moduleEnvFromPlatform(platform);
    const modules = await discoverModules(modEnv, { cacheTtlMs: 60_000 });
    // BOTH halves are projections now (cf#129 phase 2): the studio hardcodes no model names at all.
    return c.json({
      models: [...planningModelsFromModules(modules), ...imageModelsFromModules(modules)],
    });
  });

  app.post("/api/chat", async (c) => {
    try {
      const body = await readBody<ChatCompleteArgs & ChatImageArgs>(c.req.raw);
      if (!body.model || !body.user_input) throw badRequest("model and user_input required");

      // Image or text? Ask the INSTALLED modules, not a hardcoded catalog: an id declared by an
      // image.generate module is an image request, everything else falls through to the text path.
      const modEnv = moduleEnvFromPlatform(platform);
      const modules = await discoverModules(modEnv, { cacheTtlMs: 60_000 });
      const imageTarget = resolveCatalogTarget(modules, "image.generate", body.model);
      if (imageTarget) {
        // platform.renders is the store /api/artifact SERVES. Passing the served store (not
        // platform.chatBucket) is the cf#140 fix: write and serve can no longer be different stores.
        const r = await chatImageViaModule(modEnv, modules, platform.renders, body);
        if (!r.ok) return c.json({ error: r.error, model: r.model }, 502);
        return c.json({
          model: r.model,
          model_type: "image",
          output: r.output,
          output_artifact: r.output_artifact,
          latency_ms: r.latency_ms,
          ai_gateway_log_id: r.ai_gateway_log_id,
        });
      }

      const a = body as ChatCompleteArgs;
      const r = await chatComplete({ modEnv, modules }, a);
      if (!r.ok) return c.json({ error: r.error, model: r.model }, 422);
      return c.json({ output: r.output, model: r.model, logId: r.logId });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
