// M6 routes: planner audio beat analysis.

import type { Hono } from "hono";
import { analyzeAudioBeats } from "@skyphusion-labs/vivijure-core/beat-analyze";
import type { AudioAnalyzeRequest } from "@skyphusion-labs/vivijure-core/runpod-types";
import { isSafeRelKey } from "@skyphusion-labs/vivijure-core/key-safety";
import { ARTIFACT_PREFIXES } from "../artifacts.js";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import type { Platform } from "../platform/types.js";

function isServedArtifactKey(key: string): boolean {
  if (!isSafeRelKey(key) || key.startsWith("quarantine/")) return false;
  return ARTIFACT_PREFIXES.some((pre) => key.startsWith(pre));
}

export function registerM6Routes(app: Hono, platform: Platform): void {
  app.post("/api/audio/analyze", async (c) => {
    try {
      const body = await readBody<AudioAnalyzeRequest & { module?: string }>(c.req.raw);
      if (!body.audioKey) throw badRequest("audioKey required");
      const audioKey = body.audioKey.trim();
      if (!isServedArtifactKey(audioKey)) throw badRequest("audioKey is outside served artifact space");
      const env = orchestratorContextFromPlatform(platform);
      const result = await analyzeAudioBeats(env, { ...body, audioKey }, body.module?.trim() || undefined);
      if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
      return c.json({ ok: true, output: result.plan, module: result.module });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
