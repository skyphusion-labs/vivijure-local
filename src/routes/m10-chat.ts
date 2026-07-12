// M10 routes: POST /api/chat (text completions via planner catalog).

import type { Hono } from "hono";
import { badRequest, httpErrorResponse } from "../errors.js";
import { json, readBody } from "../http.js";
import { chatComplete, type ChatCompleteArgs } from "../planner.js";
import type { SettingsHost } from "./m8-settings.js";
import { plannerEnvFromVars } from "../planner-env.js";

export function registerM10Routes(app: Hono, host: SettingsHost): void {
  const platform = host.platform;
  const plannerEnv = () => plannerEnvFromVars(platform.vars);

  app.post("/api/chat", async (c) => {
    try {
      const a = await readBody<ChatCompleteArgs>(c.req.raw);
      if (!a.model || !a.user_input) throw badRequest("model and user_input required");
      const r = await chatComplete(plannerEnv(), a);
      if (!r.ok) return c.json({ error: r.error, model: r.model }, 422);
      return c.json({ output: r.output, model: r.model, logId: r.logId });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
