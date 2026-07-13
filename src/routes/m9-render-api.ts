// M9 routes: explicit film + clip render APIs.

import type { Hono } from "hono";
import { resolveCastLoras, untrainedCastMessage } from "@skyphusion-labs/vivijure-core/cast-loras";
import {
  dialogueLinesFromBundleScenes,
  resolveExplicitLineVoices,
} from "@skyphusion-labs/vivijure-core/dialogue-lines";
import type { DialogueLine } from "@skyphusion-labs/vivijure-core/modules/types";
import { readBundleScenes } from "@skyphusion-labs/vivijure-core/bundle-storyboard";
import { summarizeFilm, type FilmScene } from "@skyphusion-labs/vivijure-core/film-model";
import type { FilmSummary } from "@skyphusion-labs/vivijure-core/film-model";
import {
  filmJobToPollView,
  filmRenderRowSeedFromJob,
  isFilmJobId,
} from "@skyphusion-labs/vivijure-core/film-render-bridge";
import { advanceFilmJob, startFilmJob } from "@skyphusion-labs/vivijure-core/film-orchestrator";
import { summarizeJob } from "@skyphusion-labs/vivijure-core/clip-job-model";
import {
  advanceClipJob,
  startClipJob,
  type ClipShotInput,
} from "@skyphusion-labs/vivijure-core/render-orchestrator";
import { isSafeBundleKey } from "@skyphusion-labs/vivijure-core/key-safety";
import {
  discoverModules,
  emitStructuredEvent,
  motionBackendPreflightError,
  motionConfigPreflightError,
} from "@skyphusion-labs/vivijure-core";
import {
  noopExecutionContext,
  orchestratorContextFromPlatform,
  type OrchestratorEnv,
} from "@skyphusion-labs/vivijure-core/platform";
import { presignR2Get, FILM_DOWNLOAD_TTL_SECONDS } from "@skyphusion-labs/vivijure-core/presign";
import { coerceQualityTier, deriveProjectFromBundleKey } from "@skyphusion-labs/vivijure-core/runpod-types";
import {
  insertRender,
  type NewRenderRow,
  updateRenderFromView,
} from "@skyphusion-labs/vivijure-core/renders-db";
import { badRequest, forbidden, httpErrorResponse, notFound } from "../errors.js";
import { isCrossSiteRequest, CSRF_ADVANCE_MSG } from "../auth-gate.js";
import { json, readBody } from "../http.js";
import type { Platform } from "../platform/types.js";
import { readKeyframeDone } from "../render-progress.js";

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

function filmRowFromJob(job: Parameters<typeof filmRenderRowSeedFromJob>[0]): NewRenderRow {
  return filmRenderRowSeedFromJob(job);
}

async function insertRenderBestEffort(env: OrchestratorEnv, row: NewRenderRow): Promise<void> {
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

async function withFilmDownloadUrl(
  env: OrchestratorEnv,
  summary: FilmSummary,
): Promise<FilmSummary & { download_url?: string; clip_urls?: { shot_id: string; download_url: string }[] }> {
  if (summary.phase === "done" && summary.film_key) {
    return { ...summary, download_url: await presignR2Get(env, summary.film_key, FILM_DOWNLOAD_TTL_SECONDS) };
  }
  const u = summary.finish_unavailable;
  if (summary.phase === "done" && u?.at === "assemble" && u.clips?.length) {
    const clip_urls = await Promise.all(
      u.clips.map(async (c) => ({
        shot_id: c.shot_id,
        download_url: await presignR2Get(env, c.clip_key, FILM_DOWNLOAD_TTL_SECONDS),
      })),
    );
    return { ...summary, clip_urls };
  }
  return summary;
}

async function withFilmDownloadUrlBestEffort(
  env: OrchestratorEnv,
  summary: FilmSummary,
): Promise<FilmSummary & { download_url?: string; clip_urls?: { shot_id: string; download_url: string }[] }> {
  try {
    return await withFilmDownloadUrl(env, summary);
  } catch (e) {
    emitStructuredEvent({
      ev: "render.bookkeeping_deferred",
      op: "withFilmDownloadUrl",
      film_id: summary.film_id,
      err: e instanceof Error ? e.message : String(e),
    });
    return summary;
  }
}

export function registerM9Routes(app: Hono, platform: Platform): void {
  const env = () => orchestratorContextFromPlatform(platform);

  app.post("/api/render/clips", async (c) => {
    try {
      const a = await readBody<{
        project?: string;
        shots?: ClipShotInput[];
        motion_backend?: string;
        config?: Record<string, unknown>;
      }>(c.req.raw);
      if (!Array.isArray(a.shots) || a.shots.length === 0) throw badRequest("shots[] required");
      const job = await startClipJob(env(), {
        project: a.project ?? "clips",
        shots: a.shots,
        motion_backend: a.motion_backend,
        config: a.config,
      });
      return json({
        ok: true,
        job_id: job.job_id,
        motion_backend: job.motion_backend,
        ...summarizeJob(job),
        shots: job.shots.map((sh) => ({ shot_id: sh.shot_id, status: sh.status, error: sh.error })),
      });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.get("/api/render/clips/:id", async (c) => {
    try {
      const job = await advanceClipJob(env(), c.req.param("id"));
      if (!job) throw notFound("clip job");
      return json({
        ok: true,
        job_id: job.job_id,
        motion_backend: job.motion_backend,
        ...summarizeJob(job),
        shots: job.shots.map((sh) => ({
          shot_id: sh.shot_id,
          status: sh.status,
          clip_key: sh.clip_key,
          error: sh.error,
        })),
      });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.post("/api/render/film", async (c) => {
    try {
      const a = await readBody<{
        project?: string;
        bundle_key?: string;
        scenes?: FilmScene[];
        motion_backend?: string;
        keyframe_backend?: string;
        keyframe_config?: Record<string, unknown>;
        motion_config?: Record<string, unknown>;
        finish_config?: Record<string, Record<string, unknown>>;
        speech_config?: Record<string, Record<string, unknown>>;
        film_finish_config?: Record<string, Record<string, unknown>>;
        master_config?: Record<string, Record<string, unknown>>;
        audio_key?: string;
        film_titles?: { title?: { text: string; subtitle?: string }; credits?: { lines: string[] } };
        dialogue_lines?: DialogueLine[];
        cast_loras?: Record<string, string>;
        qualityTier?: string;
      }>(c.req.raw);
      if (!a.bundle_key) throw badRequest("bundle_key required");
      if (!isSafeBundleKey(a.bundle_key)) {
        throw badRequest("bundle_key must be a plain relative key under bundles/");
      }
      if (!Array.isArray(a.scenes) || a.scenes.length === 0) throw badRequest("scenes[] required");
      assertConfigMapShape("keyframe_config", a.keyframe_config);
      assertConfigMapShape("motion_config", a.motion_config);
      assertModuleConfigMap("finish_config", a.finish_config);
      assertModuleConfigMap("speech_config", a.speech_config);
      assertModuleConfigMap("film_finish_config", a.film_finish_config);
      assertModuleConfigMap("master_config", a.master_config);

      const oenv = env();
      const filmModules = await discoverModules(oenv, { cacheTtlMs: 60_000 });
      const filmMotionErr = motionBackendPreflightError(filmModules, a.motion_backend);
      if (filmMotionErr) throw badRequest(filmMotionErr);
      const filmCfgErr = motionConfigPreflightError(filmModules, a.motion_backend, a.motion_config);
      if (filmCfgErr) throw badRequest(filmCfgErr);

      const resolvedLoras =
        a.cast_loras && Object.keys(a.cast_loras).length
          ? await resolveCastLoras(oenv, a.cast_loras)
          : null;
      if (resolvedLoras && resolvedLoras.skipped.length) {
        throw badRequest(untrainedCastMessage(resolvedLoras.skippedDetail));
      }
      const castIds =
        resolvedLoras && Object.keys(resolvedLoras.castIds).length ? resolvedLoras.castIds : undefined;

      let dialogue_lines = a.dialogue_lines;
      if (!dialogue_lines || !dialogue_lines.length) {
        const bundleScenes = await readBundleScenes(oenv, a.bundle_key);
        if (bundleScenes.some((s) => s.dialogue)) {
          dialogue_lines = dialogueLinesFromBundleScenes(bundleScenes, resolvedLoras?.voices ?? {});
        }
      } else if (
        resolvedLoras &&
        Object.keys(resolvedLoras.voices).length &&
        dialogue_lines.some((l) => !(typeof l.voice_id === "string" && l.voice_id.trim()))
      ) {
        const bundleScenes = await readBundleScenes(oenv, a.bundle_key);
        dialogue_lines = resolveExplicitLineVoices(dialogue_lines, bundleScenes, resolvedLoras.voices);
      }

      const project = a.project ?? deriveProjectFromBundleKey(a.bundle_key);
      const job = await startFilmJob(
        oenv,
        {
          project,
          bundle_key: a.bundle_key,
          scenes: a.scenes,
          motion_backend: a.motion_backend,
          keyframe_backend: a.keyframe_backend,
          keyframe_config: a.keyframe_config,
          motion_config: a.motion_config,
          finish_config: a.finish_config,
          speech_config: a.speech_config,
          film_finish_config: a.film_finish_config,
          master_config: a.master_config,
          audio_key: a.audio_key,
          film_titles: a.film_titles,
          dialogue_lines,
          cast_loras: castIds,
          pretrained_loras:
            resolvedLoras && Object.keys(resolvedLoras.pretrained).length
              ? resolvedLoras.pretrained
              : undefined,
          quality_tier: coerceQualityTier(a.qualityTier),
        },
        filmModules,
      );
      await insertRenderBestEffort(oenv, filmRowFromJob(job));
      return json(
        { ok: true, ...(await withFilmDownloadUrlBestEffort(oenv, summarizeFilm(job, null))) },
        201,
      );
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.get("/api/render/film/:id", async (c) => {
    try {
      // #46: this GET ADVANCES the film job with the ambient vivijure_token cookie; reject a cross-site
      // browser request so a malicious page can't drive it via CSRF.
      if (isCrossSiteRequest(c.req.raw)) throw forbidden(CSRF_ADVANCE_MSG);
      const jobId = c.req.param("id");
      if (!isFilmJobId(jobId)) throw notFound("film job");
      const oenv = env();
      const r = await advanceFilmJob(oenv, jobId);
      if (!r) throw notFound("film job");
      await insertRender(oenv, filmRowFromJob(r.job));
      const kfDone =
        r.job.phase === "keyframe" && r.job.keyframe_job_id
          ? await readKeyframeDone(oenv, r.job.project, r.job.keyframe_job_id)
          : undefined;
      await updateRenderFromView(oenv, filmJobToPollView(r.job, r.clipJob, kfDone), noopExecutionContext);
      return json({ ok: true, ...(await withFilmDownloadUrl(oenv, summarizeFilm(r.job, r.clipJob))) });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
