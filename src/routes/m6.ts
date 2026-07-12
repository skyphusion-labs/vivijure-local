// M6 routes: planner audio beat analysis.

import type { Hono } from "hono";
import { analyzeAudioBeats, type AudioAnalyzeRequest } from "../beat-analyze.js";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import type { Platform } from "../platform/types.js";

export function registerM6Routes(app: Hono, platform: Platform): void {
  app.post("/api/audio/analyze", async (c) => {
    try {
      const body = await readBody<AudioAnalyzeRequest & { module?: string }>(c.req.raw);
      if (!body.audioKey) throw badRequest("audioKey required");
      const env = orchestratorContextFromPlatform(platform);
      const result = await analyzeAudioBeats(env, body, body.module?.trim() || undefined);
      if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
      return c.json({ ok: true, output: result.plan, module: result.module });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
