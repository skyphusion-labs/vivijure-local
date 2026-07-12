// M12: planner YAML/markers/score-bed/render-plan + storyboard uploads + job poll.

import type { Hono } from "hono";
import { badRequest, httpErrorResponse } from "../errors.js";
import { json, readBody } from "../http.js";
import {
  discoverModules,
  resolveRenderPipeline,
  type RenderPipelineSelection,
} from "@skyphusion-labs/vivijure-core";
import { serializeStoryboardYaml } from "@skyphusion-labs/vivijure-core/planner-yaml";
import { validateStoryboard } from "@skyphusion-labs/vivijure-core/storyboard-validate";
import { moduleEnvFromPlatform } from "../platform/module-env.js";
import type { Platform } from "../platform/types.js";
import type { ArtifactStore } from "../platform/create-storage.js";
import { emitMarkers, type MarkersFormat } from "../markers.js";
import { pollScoreBedGenerate, startScoreBedGenerate } from "../score-bed.js";
import {
  handleStoryboardAudioUpload,
  handleStoryboardCharacterRef,
} from "../storyboard-uploads.js";

const MARKERS_FORMATS: readonly MarkersFormat[] = ["premiere_csv", "resolve_csv"];

async function handle(c: { req: { raw: Request } }, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const res = httpErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

export function registerM12Routes(app: Hono, platform: Platform): void {
  const modEnv = () => moduleEnvFromPlatform(platform);
  const store = () => platform.renders as ArtifactStore;

  app.post("/api/storyboard/yaml", (c) =>
    handle(c, async () => {
      const a = await readBody<{ storyboard?: unknown }>(c.req.raw);
      if (!a.storyboard) throw badRequest("storyboard required");
      const v = validateStoryboard(a.storyboard);
      if (!v.ok) throw badRequest(`storyboard invalid: ${v.errors.join("; ")}`);
      return json({ ok: true, yaml: serializeStoryboardYaml(v.value) });
    }),
  );

  app.post("/api/storyboard/markers", (c) =>
    handle(c, async () => {
      const a = await readBody<{ storyboard?: unknown; format?: MarkersFormat; fps?: number }>(c.req.raw);
      if (!a.storyboard || !a.format) throw badRequest("storyboard and format required");
      if (!MARKERS_FORMATS.includes(a.format)) {
        throw badRequest(`format must be one of: ${MARKERS_FORMATS.join(", ")}`);
      }
      const out = emitMarkers(
        a.storyboard as Parameters<typeof emitMarkers>[0],
        a.format,
        a.fps,
      );
      return new Response(out.body, {
        headers: {
          "content-type": out.contentType,
          "content-disposition": `attachment; filename="${out.filename}"`,
        },
      });
    }),
  );

  app.post("/api/storyboard/score-bed", (c) =>
    handle(c, async () => {
      const a = await readBody<Parameters<typeof startScoreBedGenerate>[1]>(c.req.raw);
      const r = await startScoreBedGenerate(modEnv(), a);
      if (!r.ok) return json({ error: r.error }, 422);
      return json({ status: r.status, id: r.id, module: r.module, label: r.label });
    }),
  );

  app.post("/api/storyboard/music-generate", (c) =>
    handle(c, async () => {
      const a = await readBody<Parameters<typeof startScoreBedGenerate>[1]>(c.req.raw);
      const r = await startScoreBedGenerate(modEnv(), a);
      if (!r.ok) return json({ error: r.error }, 422);
      return json({ status: r.status, id: r.id, module: r.module, label: r.label });
    }),
  );

  app.get("/api/job/:id", (c) =>
    handle(c, async () => {
      const module = new URL(c.req.raw.url).searchParams.get("module")?.trim() || "";
      if (!module) throw badRequest("module query param required");
      return json(await pollScoreBedGenerate(modEnv(), c.req.param("id"), module));
    }),
  );

  app.post("/api/storyboard/render-plan", (c) =>
    handle(c, async () => {
      const a = await readBody<{ selection?: RenderPipelineSelection }>(c.req.raw);
      const modules = await discoverModules(modEnv(), { cacheTtlMs: 60_000 });
      return json({ ok: true, plan: resolveRenderPipeline(modules, a.selection ?? {}) });
    }),
  );

  app.post("/api/storyboard/audio-upload", (c) =>
    handle(c, async () => handleStoryboardAudioUpload(c.req.raw, store())),
  );

  app.post("/api/storyboard/character-ref", (c) =>
    handle(c, async () => handleStoryboardCharacterRef(c.req.raw, store())),
  );
}
