// M5 routes: film submit + poll (POST/GET /api/storyboard/render).

import type { Hono } from "hono";
import { resolveCastLoras, untrainedCastMessage } from "../cast-loras.js";
import { badRequest, httpErrorResponse } from "../errors.js";
import { readBody } from "../http.js";
import {
  discoverModules,
  motionBackendPreflightError,
  motionConfigPreflightError,
  servingForHook,
} from "../modules/registry.js";
import { advanceFilmJob, startFilmJob } from "../film-orchestrator.js";
import {
  filmJobToPollView,
  filterScenesByShotIds,
  isFilmJobId,
  mapRenderOverridesToModuleConfigs,
  normalizeFilmScenes,
} from "../film-render-bridge.js";
import { noopExecutionContext } from "../orchestrator-env.js";
import { orchestratorEnvFromPlatform } from "../platform/orchestrator-env.js";
import type { Platform } from "../platform/types.js";
import { isPublicId } from "../public-id.js";
import { readKeyframeDone } from "../render-progress.js";
import {
  parseModuleRenderOverrides,
} from "../render-module-config.js";
import { coerceQualityTier, deriveProjectFromBundleKey } from "../runpod-types.js";
import {
  insertRender,
  type NewRenderRow,
  updateRenderFromView,
} from "../renders-db.js";
import { getProjectIdByPublicId } from "../storyboard-projects-db.js";
import { isSafeBundleKey } from "../shared.js";
import { emitStructuredEvent } from "../structured-events.js";

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

async function insertRenderBestEffort(env: ReturnType<typeof orchestratorEnvFromPlatform>, row: NewRenderRow) {
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
  const env = () => orchestratorEnvFromPlatform(platform);

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
      if (!isFilmJobId(jobId)) {
        return c.json({ error: "unknown or legacy render job id (film-* only)", jobId }, 404);
      }

      const oenv = env();
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
}
