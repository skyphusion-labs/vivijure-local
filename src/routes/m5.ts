// M5 routes: film submit + poll (POST/GET /api/storyboard/render).

import type { Hono } from "hono";
import { resolveCastLoras, untrainedCastMessage } from "@skyphusion-labs/vivijure-core/cast-loras";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import {
  discoverModules,
  motionBackendPreflightError,
  motionConfigPreflightError,
  servingForHook,
  emitStructuredEvent,
  defaultGpuDoorModule,
} from "@skyphusion-labs/vivijure-core";
import {
  noopExecutionContext,
  orchestratorContextFromPlatform,
  type OrchestratorEnv,
} from "@skyphusion-labs/vivijure-core/platform";
import {
  advanceFilmJob,
  cancelFilmJob,
  startFilmJob,
  startFilmFromKeyframes,
  type FilmScene,
} from "@skyphusion-labs/vivijure-core/film-orchestrator";
import {
  filmJobToPollView,
  filterScenesByShotIds,
  isFilmJobId,
  mapRenderOverridesToModuleConfigs,
  normalizeFilmScenes,
} from "@skyphusion-labs/vivijure-core/film-render-bridge";
import type { Platform } from "../platform/types.js";
import {
  advanceScatterJob,
  cancelScatterJob,
  isScatterJobId,
  scatterJobToPollView,
  startScatterRender,
} from "@skyphusion-labs/vivijure-core/scatter-orchestrator";
import { readBundleScenes } from "@skyphusion-labs/vivijure-core/bundle-storyboard";
import { stageBundleInjectedKeyframes } from "../bundle-keyframes.js";
import { isPublicId } from "@skyphusion-labs/vivijure-core/public-id";
import { readKeyframeDone } from "../render-progress.js";
import { parseModuleRenderOverrides } from "@skyphusion-labs/vivijure-core/render-module-config";
import { coerceQualityTier, deriveProjectFromBundleKey } from "@skyphusion-labs/vivijure-core/runpod-types";
import {
  insertRender,
  type NewRenderRow,
  updateRenderFromView,
} from "@skyphusion-labs/vivijure-core/renders-db";
import { getProjectIdByPublicId } from "@skyphusion-labs/vivijure-core/storyboard-projects-db";
import { isSafeBundleKey } from "@skyphusion-labs/vivijure-core/key-safety";

function assertConfigMapShape(label: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(
      `${label} must be a JSON object (a { key: value } map), not a ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`,
    );
  }
}

function assertModuleConfigMap(label: string, value: unknown): void {
  assertConfigMapShape(label, value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, cfg] of Object.entries(value as Record<string, unknown>)) {
      assertConfigMapShape(`${label}.${name}`, cfg);
    }
  }
}

async function resolveProjectRef(platform: Platform, raw: unknown): Promise<number | null> {
  if (!isPublicId(raw)) return null;
  return getProjectIdByPublicId({ DB: platform.db }, raw);
}

async function insertRenderBestEffort(env: OrchestratorEnv, row: NewRenderRow) {
  try {
    await insertRender(env, row);
  } catch (e) {
    emitStructuredEvent({
      ev: "render.bookkeeping_deferred",
      op: "insertRender",
      job_id: row.jobId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export function registerM5Routes(app: Hono, platform: Platform): void {
  const env = () => orchestratorContextFromPlatform(platform);

  app.post("/api/storyboard/render", async (c) => {
    try {
      const body = await readBody<{
        project?: string;
        bundleKey?: string;
        qualityTier?: string;
        renderOverrides?: Record<string, unknown>;
        keyframesOnly?: boolean;
        audioKey?: string;
        processShotIds?: string[];
        projectId?: unknown;
        scenes?: unknown;
        motion_backend?: string;
        castLoras?: Record<string, unknown>;
        film_titles?: { title?: { text: string; subtitle?: string }; credits?: { lines: string[] } };
      }>(c.req.raw);

      if (!body.bundleKey) throw badRequest("bundleKey required");
      if (!isSafeBundleKey(body.bundleKey)) {
        throw badRequest("bundleKey must be a plain relative key under bundles/");
      }
      assertConfigMapShape("renderOverrides", body.renderOverrides);
      assertModuleConfigMap("renderOverrides.config", body.renderOverrides?.config);

      const tier = coerceQualityTier(body.qualityTier) ?? "final";
      const project = body.project ?? deriveProjectFromBundleKey(body.bundleKey);
      const oenv = env();

      const modules = await discoverModules(oenv, { cacheTtlMs: 60_000 });
      if (servingForHook(modules, "keyframe").length === 0) {
        return c.json({ error: "no keyframe module installed (bind MODULE_KEYFRAME)" }, 503);
      }

      const scenes = filterScenesByShotIds(normalizeFilmScenes(body.scenes), body.processShotIds);
      if (!scenes.length) {
        throw badRequest("scenes[] required (storyboard shots with prompt and duration)");
      }

      if (!body.keyframesOnly) {
        const parsedOverrides = parseModuleRenderOverrides(body.renderOverrides);
        const explicitMotionBackend = body.motion_backend ?? parsedOverrides.motion_backend;
        const motionErr = motionBackendPreflightError(modules, explicitMotionBackend);
        if (motionErr) throw badRequest(motionErr);
        const cfgErr = motionConfigPreflightError(
          modules,
          explicitMotionBackend,
          parsedOverrides.config?.[(explicitMotionBackend ?? "").trim()],
        );
        if (cfgErr) throw badRequest(cfgErr);
      }

      const { pretrained, castIds, skipped, skippedDetail } = await resolveCastLoras(oenv, body.castLoras);
      if (skipped.length) throw badRequest(untrainedCastMessage(skippedDetail));

      const mapped = mapRenderOverridesToModuleConfigs(body.renderOverrides, tier, modules);
      const motionBackend = body.keyframesOnly ? undefined : (body.motion_backend ?? mapped.motion_backend);

      const job = await startFilmJob(
        oenv,
        {
          project,
          bundle_key: body.bundleKey,
          scenes,
          motion_backend: motionBackend,
          keyframe_backend: mapped.keyframe_backend,
          keyframe_config: mapped.keyframe_config,
          motion_config: mapped.motion_config,
          finish_config: mapped.finish_config,
          speech_config: mapped.speech_config,
          film_finish_config: mapped.film_finish_config,
          master_config: mapped.master_config,
          keyframes_only: !!body.keyframesOnly,
          audio_key: body.keyframesOnly ? undefined : body.audioKey,
          film_titles: body.keyframesOnly ? undefined : body.film_titles,
          pretrained_loras: Object.keys(pretrained).length ? pretrained : undefined,
          cast_loras: Object.keys(castIds).length ? castIds : undefined,
        },
        modules,
      );

      const view = filmJobToPollView(job, null);
      const row: NewRenderRow = {
        jobId: view.jobId,
        project,
        bundleKey: body.bundleKey,
        qualityTier: tier,
        renderOverrides: body.renderOverrides,
        status: view.status,
        mode: body.keyframesOnly ? "keyframes-only" : "full",
        projectId: await resolveProjectRef(platform, body.projectId),
      };
      await insertRenderBestEffort(oenv, row);
      return c.json(view, 201);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.get("/api/storyboard/render/:jobId", async (c) => {
    try {
      const jobId = c.req.param("jobId");
      const oenv = env();

      if (isScatterJobId(jobId)) {
        const view = await advanceScatterJob(oenv, jobId, noopExecutionContext);
        if (!view) return c.json({ error: "render job not found" }, 404);
        await updateRenderFromView(oenv, view, noopExecutionContext);
        return c.json(view);
      }

      if (!isFilmJobId(jobId)) {
        return c.json(
          { error: "unknown or legacy render job id (film-* or scatter-* only)", jobId },
          404,
        );
      }

      const r = await advanceFilmJob(oenv, jobId);
      if (!r) return c.json({ error: "render job not found" }, 404);

      const kfDone =
        r.job.phase === "keyframe" && r.job.keyframe_job_id
          ? await readKeyframeDone(oenv, r.job.project, r.job.keyframe_job_id)
          : undefined;

      const view = filmJobToPollView(r.job, r.clipJob, kfDone);
      await updateRenderFromView(oenv, view, noopExecutionContext);
      return c.json(view);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.post("/api/storyboard/render/scatter", async (c) => {
    try {
      const b = await readBody<{
        project?: string;
        bundleKey?: string;
        qualityTier?: string;
        shotIds?: string[];
        shardCount?: number;
        castLoras?: Record<string, unknown>;
        renderOverrides?: Record<string, unknown>;
        audioKey?: string;
        projectId?: unknown;
        motion_backend?: string;
        film_titles?: { title?: { text: string; subtitle?: string }; credits?: { lines: string[] } };
      }>(c.req.raw);

      if (!b.bundleKey) throw badRequest("bundleKey required");
      if (!isSafeBundleKey(b.bundleKey)) {
        throw badRequest("bundleKey must be a plain relative key under bundles/");
      }
      if (!Array.isArray(b.shotIds) || b.shotIds.length < 2) {
        throw badRequest("shotIds[] required (>= 2)");
      }
      const shardCount = typeof b.shardCount === "number" ? b.shardCount : 2;
      const project = b.project ?? deriveProjectFromBundleKey(b.bundleKey);
      const tier = coerceQualityTier(b.qualityTier) ?? "final";
      const oenv = env();

      const scatterModules = await discoverModules(oenv, { cacheTtlMs: 60_000 });
      const scatterOverrides = parseModuleRenderOverrides(b.renderOverrides);
      const scatterBackend = b.motion_backend ?? scatterOverrides.motion_backend;
      const scatterMotionErr = motionBackendPreflightError(scatterModules, scatterBackend);
      if (scatterMotionErr) throw badRequest(scatterMotionErr);
      const scatterCfgErr = motionConfigPreflightError(
        scatterModules,
        scatterBackend,
        scatterOverrides.config?.[(scatterBackend ?? "").trim()],
      );
      if (scatterCfgErr) throw badRequest(scatterCfgErr);

      const scatterCast = await resolveCastLoras(oenv, b.castLoras ?? {});
      if (scatterCast.skipped.length) throw badRequest(untrainedCastMessage(scatterCast.skippedDetail));

      try {
        const job = await startScatterRender(oenv, {
          project,
          bundle_key: b.bundleKey,
          quality_tier: tier,
          shot_ids: b.shotIds,
          shard_count: shardCount,
          cast_loras: b.castLoras ?? {},
          render_overrides: b.renderOverrides,
          motion_backend: b.motion_backend,
          audio_key: b.audioKey,
          film_titles: b.film_titles,
          project_id: await resolveProjectRef(platform, b.projectId),
        });
        const view = scatterJobToPollView(job);
        return c.json({ ok: true, jobId: view.jobId, status: view.status }, 201);
      } catch (e) {
        const msg = (e as Error).message || "scatter submit failed";
        return c.json({ ok: false, error: msg }, 422);
      }
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.delete("/api/storyboard/render/:jobId", async (c) => {
    try {
      const jobId = c.req.param("jobId");
      const oenv = env();
      if (isScatterJobId(jobId)) {
        const view = await cancelScatterJob(oenv, jobId);
        if (!view) return c.json({ error: "render job not found" }, 404);
        await updateRenderFromView(oenv, view, noopExecutionContext);
        return c.json(view);
      }
      if (!isFilmJobId(jobId)) {
        return c.json(
          { error: "unknown or legacy render job id (film-* or scatter-* only)", jobId },
          404,
        );
      }
      const job = await cancelFilmJob(oenv, jobId);
      if (!job) return c.json({ error: "render job not found" }, 404);
      const view = filmJobToPollView(job, null);
      await updateRenderFromView(oenv, view, noopExecutionContext);
      return c.json(view);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.post("/api/storyboard/render-from-keyframes", async (c) => {
    try {
      const b = await readBody<{
        project?: string;
        bundleKey?: string;
        qualityTier?: string;
        renderOverrides?: Record<string, unknown>;
        audioKey?: string;
        projectId?: unknown;
        motion_backend?: string;
      }>(c.req.raw);
      if (!b.bundleKey) throw badRequest("bundleKey required");
      if (!isSafeBundleKey(b.bundleKey)) {
        throw badRequest("bundleKey must be a plain relative key under bundles/");
      }
      const project = b.project ?? deriveProjectFromBundleKey(b.bundleKey);
      const tier = coerceQualityTier(b.qualityTier) ?? "final";
      const oenv = env();
      const modules = await discoverModules(oenv, { cacheTtlMs: 60_000 });
      if (servingForHook(modules, "motion.backend").length === 0) {
        return c.json({ error: "no motion.backend module installed" }, 503);
      }
      const parsedScenes = await readBundleScenes(oenv, b.bundleKey);
      if (!parsedScenes.length) return c.json({ error: "bundle has no storyboard scenes" }, 400);
      const scenes: FilmScene[] = parsedScenes.map((s) => ({
        shot_id: s.shot_id,
        prompt: s.prompt,
        seconds: s.seconds,
      }));
      const staged = await stageBundleInjectedKeyframes(oenv, b.bundleKey, project);
      if (!staged.length) {
        return c.json({ error: "bundle has no injected keyframes (clips/<id>_keyframe.png)" }, 400);
      }
      const mapped = mapRenderOverridesToModuleConfigs(b.renderOverrides, tier, modules);
      const motionBackend = b.motion_backend ?? mapped.motion_backend ?? defaultGpuDoorModule(modules)?.name;
      if (!motionBackend) {
        return c.json(
          { error: 'no gpu-door motion.backend module (ui.locality "byo"/"local") is installed' },
          400,
        );
      }
      const job = await startFilmFromKeyframes(
        oenv,
        {
          project,
          bundle_key: b.bundleKey,
          scenes,
          keyframes: staged,
          motion_backend: motionBackend,
          motion_config: mapped.motion_config,
          finish_config: mapped.finish_config,
          speech_config: mapped.speech_config,
          film_finish_config: mapped.film_finish_config,
          master_config: mapped.master_config,
          derive_mode: "finalized",
          audio_key: b.audioKey,
        },
        modules,
      );
      if (job.phase === "failed") {
        return c.json({ error: job.error || "render from keyframes failed" }, 422);
      }
      const view = filmJobToPollView(job, null);
      await insertRenderBestEffort(oenv, {
        jobId: view.jobId,
        project,
        bundleKey: b.bundleKey,
        qualityTier: tier,
        renderOverrides: b.renderOverrides,
        status: view.status,
        mode: "finalized",
        projectId: await resolveProjectRef(platform, b.projectId),
      });
      return c.json(view, 201);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
