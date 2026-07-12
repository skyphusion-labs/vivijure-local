// M10 routes: POST /api/chat (text completions via plan.enhance modules).

import type { Hono } from "hono";
import { discoverModules } from "@skyphusion-labs/vivijure-core";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import { chatComplete, type ChatCompleteArgs } from "../planner.js";
import type { SettingsHost } from "./m8-settings.js";
import { moduleEnvFromPlatform } from "../platform/module-env.js";

export function registerM10Routes(app: Hono, host: SettingsHost): void {
  const platform = host.platform;

  app.post("/api/chat", async (c) => {
    try {
      const a = await readBody<ChatCompleteArgs>(c.req.raw);
      if (!a.model || !a.user_input) throw badRequest("model and user_input required");
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
