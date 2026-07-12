// M10 routes: POST /api/chat (text + image), GET /api/models (image catalog).

import type { Hono } from "hono";
import { discoverModules } from "@skyphusion-labs/vivijure-core";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import { chatComplete, type ChatCompleteArgs } from "../planner.js";
import { chatImage, type ChatImageArgs } from "../chat-image.js";
import { findImageModel, IMAGE_MODELS } from "../image-models.js";
import type { SettingsHost } from "./m8-settings.js";
import { moduleEnvFromPlatform } from "../platform/module-env.js";

export function registerM10Routes(app: Hono, host: SettingsHost): void {
  const platform = host.platform;

  app.get("/api/models", (c) => c.json({ models: IMAGE_MODELS }));

  app.post("/api/chat", async (c) => {
    try {
      const body = await readBody<ChatCompleteArgs & ChatImageArgs>(c.req.raw);
      if (!body.model || !body.user_input) throw badRequest("model and user_input required");

      const imageModel = findImageModel(body.model);
      if (imageModel?.type === "image") {
        const r = await chatImage(platform.chatBucket, host.runtime.asProcessEnv(), body);
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
      const modEnv = moduleEnvFromPlatform(platform);
      const modules = await discoverModules(modEnv, { cacheTtlMs: 60_000 });
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
