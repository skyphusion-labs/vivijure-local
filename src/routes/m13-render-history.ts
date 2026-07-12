// M13: render history secondary routes (tags, regen, mux, finalize, adopt).

import type { Hono } from "hono";
import {
  cloudMotionModules,
  discoverModules,
  servingForHook,
} from "@skyphusion-labs/vivijure-core";
import { readBundleScenes } from "@skyphusion-labs/vivijure-core/bundle-storyboard";
import {
  filmJobToPollView,
  mapRenderOverridesToModuleConfigs,
} from "@skyphusion-labs/vivijure-core/film-render-bridge";
import { startFilmJob } from "@skyphusion-labs/vivijure-core/film-orchestrator";
import {
  getRenderByIdForUser,
  listUserTags,
} from "@skyphusion-labs/vivijure-core/renders-db";
import { isSafeBundleKey } from "@skyphusion-labs/vivijure-core/key-safety";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import { handleAdoptRender } from "@skyphusion-labs/vivijure-core/render-adopt";
import { muxAudioOntoRender } from "@skyphusion-labs/vivijure-core/render-mux";
import { coerceQualityTier } from "@skyphusion-labs/vivijure-core/runpod-types";
import { normalizeHybridBackends } from "@skyphusion-labs/vivijure-core/storyboard-validate";
import type { Platform } from "../platform/types.js";
import { badRequest, httpErrorResponse, notFound } from "../errors.js";
import { json, readBody } from "../http.js";
import { animateFromPreview } from "../finalize-from-keyframes.js";
import { pollScoreBedGenerate, startScoreBedGenerate } from "../score-bed.js";
import { resolveRenderId } from "../resolve-id.js";

async function handle(c: { req: { raw: Request } }, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const res = httpErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

async function animatePreviewHandler(
  env: ReturnType<typeof orchestratorContextFromPlatform>,
  renderId: number,
  args: Omit<Parameters<typeof animateFromPreview>[1], "parent">,
): Promise<Response> {
  const parent = await getRenderByIdForUser(env, renderId);
  if (!parent) throw notFound("render");
  const r = await animateFromPreview(env, { parent, ...args });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status ?? 400);
  return json({ ok: true, ...r.view }, 201);
}

export function registerM13Routes(app: Hono, platform: Platform): void {
  const env = () => orchestratorContextFromPlatform(platform);
  const modEnv = () => env() as Record<string, unknown>;

  app.get("/api/storyboard/renders/tags", (c) =>
    handle(c, async () => json({ tags: await listUserTags(env()) })),
  );

  app.post("/api/storyboard/renders/adopt", (c) =>
    handle(c, async () => handleAdoptRender(c.req.raw, env())),
  );

  app.post("/api/storyboard/renders/:id/regen-shot", (c) =>
    handle(c, async () => {
      const renderId = await resolveRenderId(env(), c.req.param("id"));
      const b = await readBody<{ shotId?: string }>(c.req.raw);
      const shotId = typeof b.shotId === "string" ? b.shotId.trim() : "";
      if (!shotId) throw badRequest("shotId required");

      const row = await getRenderByIdForUser(env(), renderId);
      if (!row) throw notFound("render");
      if (row.status !== "COMPLETED") throw badRequest("render must be COMPLETED");
      if (!row.bundle_key) throw badRequest("render has no bundle_key");
      if (!isSafeBundleKey(row.bundle_key)) {
        throw badRequest("render bundle_key is not a usable bundles/ key");
      }

      const scenes = await readBundleScenes(env(), row.bundle_key);
      const scene = scenes.find((s) => s.shot_id === shotId);
      if (!scene) throw badRequest(`shot ${shotId} not in bundle storyboard`);

      const modules = await discoverModules(modEnv(), { cacheTtlMs: 60_000 });
      if (servingForHook(modules, "keyframe").length === 0) {
        return json({ ok: false, error: "no keyframe module installed (bind MODULE_KEYFRAME)" }, 503);
      }
      const tier = coerceQualityTier(row.quality_tier) ?? "final";
      const mapped = mapRenderOverridesToModuleConfigs(row.render_overrides, tier, modules);

      const job = await startFilmJob(
        env(),
        {
          project: row.project,
          bundle_key: row.bundle_key,
          scenes: [{ shot_id: scene.shot_id, prompt: scene.prompt, seconds: scene.seconds }],
          keyframe_backend: mapped.keyframe_backend,
          keyframe_config: mapped.keyframe_config,
          keyframes_only: true,
        },
        modules,
      );
      if (job.phase === "failed") {
        return json({ ok: false, error: job.error || "regen submit failed" }, 422);
      }
      const view = filmJobToPollView(job, null);
      return json({ ok: true, jobId: view.jobId, status: view.status });
    }),
  );

  app.post("/api/storyboard/renders/:id/add-audio", (c) =>
    handle(c, async () => {
      const b = await readBody<{ audioKey?: string }>(c.req.raw);
      if (!b.audioKey?.trim()) throw badRequest("audioKey required");
      const r = await muxAudioOntoRender(env(), await resolveRenderId(env(), c.req.param("id")), b.audioKey.trim());
      if (!r.ok) return json({ error: r.error }, 422);
      return json({ ok: true, output_key: r.output_key });
    }),
  );

  app.post("/api/storyboard/renders/:id/add-narration", (c) =>
    handle(c, async () => {
      const b = await readBody<{ text?: string; module?: string; config?: Record<string, unknown> }>(c.req.raw);
      if (!b.text?.trim()) throw badRequest("text required");
      const started = await startScoreBedGenerate(modEnv(), {
        kind: "narration",
        text: b.text,
        module: b.module,
        config: b.config,
      });
      if (!started.ok) return json({ error: started.error }, 422);
      for (let i = 0; i < 40; i++) {
        const polled = await pollScoreBedGenerate(modEnv(), started.id, started.module);
        if (polled.status === "done" && polled.output_artifact?.key) {
          const muxed = await muxAudioOntoRender(
            env(),
            await resolveRenderId(env(), c.req.param("id")),
            polled.output_artifact.key,
          );
          if (!muxed.ok) return json({ error: muxed.error }, 422);
          return json({
            ok: true,
            output_key: muxed.output_key,
            module: started.module,
            label: started.label,
          });
        }
        if (polled.status === "failed") {
          return json({ error: polled.job_error || "narration failed" }, 422);
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
      return json({ error: "narration timed out; try again later" }, 504);
    }),
  );

  app.post("/api/storyboard/renders/:id/finalize", (c) =>
    handle(c, async () => {
      let audioKey: string | undefined;
      try {
        const b = await readBody<{ audioKey?: string }>(c.req.raw);
        audioKey = b.audioKey;
      } catch {
        /* empty body ok */
      }
      return animatePreviewHandler(env(), await resolveRenderId(env(), c.req.param("id")), {
        deriveMode: "finalized",
        audioKey,
      });
    }),
  );

  app.post("/api/storyboard/renders/:id/animate-cloud", (c) =>
    handle(c, async () => {
      const b = await readBody<{ model?: string; perShot?: Record<string, string>; audioKey?: string }>(c.req.raw);
      return animatePreviewHandler(env(), await resolveRenderId(env(), c.req.param("id")), {
        deriveMode: "cloud-finalized",
        motionBackend: b.model,
        perShotModels: b.perShot,
        audioKey: b.audioKey,
      });
    }),
  );

  app.post("/api/storyboard/renders/:id/animate-hybrid", (c) =>
    handle(c, async () => {
      const b = await readBody<{
        backends?: unknown;
        defaultBackend?: "gpu" | "cloud";
        defaultCloudModel?: string;
        audioKey?: string;
      }>(c.req.raw);
      const modules = await discoverModules(modEnv(), { cacheTtlMs: 60_000 });
      const allowed = new Set(cloudMotionModules(modules).map((m) => m.name));
      const normalized = normalizeHybridBackends(b.backends, allowed);
      if (normalized.errors.length) throw badRequest(normalized.errors.join("; "));
      return animatePreviewHandler(env(), await resolveRenderId(env(), c.req.param("id")), {
        deriveMode: "cloud-finalized",
        hybridBackends: normalized.backends,
        defaultBackend: b.defaultBackend === "cloud" ? "cloud" : "gpu",
        defaultCloudModel: b.defaultCloudModel,
        audioKey: b.audioKey,
      });
    }),
  );
}
