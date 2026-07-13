// M3 routes: projects, cast, prefs CRUD.

import type { Hono } from "hono";
import {
  clearPortrait,
  createCast,
  deleteCast,
  getCastById,
  listCast,
  toPublicCast,
  updateCast,
} from "@skyphusion-labs/vivijure-core/cast-db";
import {
  deleteCastArtifacts,
  handleCastPortraitUpload,
  handleCastRefAdd,
  handleCastRefRemove,
  handleCastSourceAdd,
  handleCastSourceRemove,
  type CastMediaEnv,
} from "../cast-media.js";
import { badRequest, forbidden, httpErrorResponse, notFound } from "../errors.js";
import { json, readBody } from "../http.js";
import type { Platform } from "../platform/types.js";
import type { ArtifactStore } from "../platform/create-storage.js";
import { dbEnvFromPlatform, resolveCastId, resolveProjectId } from "../resolve-id.js";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  setLastStoryboard,
  toPublicProject,
  updateProjectMeta,
} from "@skyphusion-labs/vivijure-core/storyboard-projects-db";
import { getUserPrefs, setUserPrefs } from "../user-prefs.js";
import { isValidVoiceId, VOICE_CATALOG, VOICE_IDS } from "@skyphusion-labs/vivijure-core/voices";
import { authEnvFromPlatform } from "../http.js";
import { catalogForDeploy, isCrossSiteRequest, CSRF_ADVANCE_MSG } from "../auth-gate.js";
import {
  handleCastTrainLora,
  handleCastLoraStatus,
} from "@skyphusion-labs/vivijure-core/cast-lora-train";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import {
  advanceCastRefsJob,
  startCastRefsJob,
  summarizeCastRefs,
} from "../cast-image-orchestrator.js";
import { exportCastBundle, importCastBundle } from "../cast-bundle.js";

function castMediaEnv(platform: Platform): CastMediaEnv {
  return {
    DB: platform.db,
    R2_RENDERS: platform.renders as ArtifactStore,
    R2: platform.chatBucket as ArtifactStore,
  };
}

async function handle(c: { req: { raw: Request } }, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const res = httpErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

/** Greedy tail after a fixed prefix, URL-decoded (artifact/cast ref keys). */
function tailAfter(pathname: string, prefix: string): string {
  if (!pathname.startsWith(prefix)) return "";
  return decodeURIComponent(pathname.slice(prefix.length));
}

export function registerM3Routes(app: Hono, platform: Platform): void {
  const db = () => dbEnvFromPlatform(platform);
  const media = () => castMediaEnv(platform);

  app.get("/api/voices", (c) =>
    handle(c, async () =>
      json({ voices: catalogForDeploy(authEnvFromPlatform(platform), VOICE_CATALOG) }),
    ),
  );

  // --- projects ---
  app.get("/api/storyboard/projects", (c) =>
    handle(c, async () => json({ projects: (await listProjects(db())).map(toPublicProject) })),
  );

  app.post("/api/storyboard/projects", (c) =>
    handle(c, async () => {
      const b = await readBody<{ name?: string; prefs?: Record<string, unknown> }>(c.req.raw);
      if (!b.name) throw badRequest("name required");
      const project = await createProject(db(), { name: b.name, prefs: b.prefs });
      return json({ project: toPublicProject(project) }, 201);
    }),
  );

  app.get("/api/storyboard/projects/:id", (c) =>
    handle(c, async () => {
      const row = await getProjectById(db(), await resolveProjectId(db(), c.req.param("id")));
      if (!row) throw notFound("project");
      return json({ project: toPublicProject(row) });
    }),
  );

  app.patch("/api/storyboard/projects/:id", (c) =>
    handle(c, async () => {
      const id = await resolveProjectId(db(), c.req.param("id"));
      const b = await readBody<{ name?: string; prefs?: Record<string, unknown>; storyboard?: unknown }>(
        c.req.raw,
      );
      const row =
        b.storyboard !== undefined
          ? await setLastStoryboard(db(), id, b.storyboard)
          : await updateProjectMeta(db(), id, { name: b.name, prefs: b.prefs });
      if (!row) throw notFound("project");
      return json({ project: toPublicProject(row) });
    }),
  );

  app.post("/api/storyboard/projects/:id/storyboard", (c) =>
    handle(c, async () => {
      const b = await readBody<{ storyboard?: unknown }>(c.req.raw);
      if (b.storyboard === undefined) throw badRequest("storyboard required");
      const row = await setLastStoryboard(db(), await resolveProjectId(db(), c.req.param("id")), b.storyboard);
      if (!row) throw notFound("project");
      return json({ project: toPublicProject(row) });
    }),
  );

  app.delete("/api/storyboard/projects/:id", (c) =>
    handle(c, async () => {
      const row = await deleteProject(db(), await resolveProjectId(db(), c.req.param("id")));
      if (!row) throw notFound("project");
      return json({ ok: true, deleted: row.public_id });
    }),
  );

  // --- cast ---
  app.get("/api/cast", (c) =>
    handle(c, async () => json({ cast: (await listCast(db())).map(toPublicCast) })),
  );

  app.post("/api/cast", (c) =>
    handle(c, async () => {
      const b = await readBody<{ name?: string; bible?: string | null }>(c.req.raw);
      if (!b.name) throw badRequest("name required");
      const member = await createCast(db(), { name: b.name, bible: b.bible });
      return json({ cast: toPublicCast(member) }, 201);
    }),
  );

  app.get("/api/cast/:id", (c) =>
    handle(c, async () => {
      const row = await getCastById(db(), await resolveCastId(db(), c.req.param("id")));
      if (!row) throw notFound("cast member");
      return json({ cast: toPublicCast(row) });
    }),
  );

  app.patch("/api/cast/:id", (c) =>
    handle(c, async () => {
      const b = await readBody<{ name?: string; bible?: string | null; voice_id?: string | null }>(c.req.raw);
      const patch: { name?: string; bible?: string | null; voice_id?: string | null } = {
        name: b.name,
        bible: b.bible,
      };
      if (b.voice_id !== undefined) {
        if (b.voice_id === null || b.voice_id === "") patch.voice_id = null;
        else if (isValidVoiceId(b.voice_id)) patch.voice_id = b.voice_id;
        else throw badRequest(`voice_id must be one of: ${VOICE_IDS.join(", ")}`);
      }
      const row = await updateCast(db(), await resolveCastId(db(), c.req.param("id")), patch);
      if (!row) throw notFound("cast member");
      return json({ cast: toPublicCast(row) });
    }),
  );

  app.delete("/api/cast/:id", (c) =>
    handle(c, async () => {
      const row = await deleteCast(db(), await resolveCastId(db(), c.req.param("id")));
      if (!row) throw notFound("cast member");
      await deleteCastArtifacts(media(), row);
      return json({ ok: true, deleted: row.public_id });
    }),
  );

  app.post("/api/cast/:id/portrait", (c) =>
    handle(c, async () =>
      handleCastPortraitUpload(c.req.raw, media(), await resolveCastId(db(), c.req.param("id"))),
    ),
  );

  app.delete("/api/cast/:id/portrait", (c) =>
    handle(c, async () => {
      const id = await resolveCastId(db(), c.req.param("id"));
      const cur = await getCastById(db(), id);
      if (!cur) throw notFound("cast member");
      if (cur.portrait_key) {
        try {
          await media().R2_RENDERS.delete(cur.portrait_key);
        } catch {
          /* ignore */
        }
      }
      const row = await clearPortrait(db(), id);
      return json({ cast: row ? toPublicCast(row) : null });
    }),
  );

  app.post("/api/cast/:id/ref", (c) =>
    handle(c, async () => handleCastRefAdd(c.req.raw, media(), await resolveCastId(db(), c.req.param("id")))),
  );

  app.delete("/api/cast/:id/ref", (c) =>
    handle(c, async () => {
      let key: string | undefined;
      try {
        const b = await readBody<{ key?: string }>(c.req.raw);
        key = b.key;
      } catch {
        key = undefined;
      }
      if (!key) throw badRequest("key required");
      return handleCastRefRemove(media(), await resolveCastId(db(), c.req.param("id")), key);
    }),
  );

  app.delete("/api/cast/:id/refs/*", (c) =>
    handle(c, async () => {
      const id = c.req.param("id");
      const refKey = tailAfter(c.req.path, `/api/cast/${id}/refs/`);
      if (!refKey) throw badRequest("key required");
      return handleCastRefRemove(media(), await resolveCastId(db(), id), refKey);
    }),
  );

  app.post("/api/cast/:id/source", (c) =>
    handle(c, async () => handleCastSourceAdd(c.req.raw, media(), await resolveCastId(db(), c.req.param("id")))),
  );

  app.delete("/api/cast/:id/source", (c) =>
    handle(c, async () => {
      let key: string | undefined;
      try {
        const b = await readBody<{ key?: string }>(c.req.raw);
        key = b.key;
      } catch {
        key = undefined;
      }
      if (!key) throw badRequest("key required");
      return handleCastSourceRemove(media(), await resolveCastId(db(), c.req.param("id")), key);
    }),
  );

  app.delete("/api/cast/:id/source/*", (c) =>
    handle(c, async () => {
      const id = c.req.param("id");
      const srcKey = tailAfter(c.req.path, `/api/cast/${id}/source/`);
      if (!srcKey) throw badRequest("key required");
      return handleCastSourceRemove(media(), await resolveCastId(db(), id), srcKey);
    }),
  );

  const oenv = () => orchestratorContextFromPlatform(platform);

  app.get("/api/cast/export/:id", (c) =>
    handle(c, async () => exportCastBundle(oenv(), await resolveCastId(db(), c.req.param("id")))),
  );

  app.post("/api/cast/export/:id", (c) =>
    handle(c, async () => exportCastBundle(oenv(), await resolveCastId(db(), c.req.param("id")))),
  );

  app.post("/api/cast/import", (c) =>
    handle(c, async () => {
      const buf = new Uint8Array(await c.req.raw.arrayBuffer());
      return importCastBundle(oenv(), buf);
    }),
  );

  app.post("/api/cast/:id/generate-refs", (c) =>
    handle(c, async () => {
      const castId = await resolveCastId(db(), c.req.param("id"));
      const b = await readBody<{
        config?: Record<string, unknown>;
        art_style?: string;
        source_keys?: string[];
        choice?: string;
      }>(c.req.raw);
      const job = await startCastRefsJob(oenv(), {
        castId,
        config: b.config,
        artStyle: b.art_style,
        sourceKeys: b.source_keys,
        choice: b.choice,
      });
      if (!job) throw notFound("cast member");
      return json({ ok: true, ...summarizeCastRefs(job) }, 201);
    }),
  );

  app.get("/api/cast/:id/refs-job/:jobId", (c) =>
    handle(c, async () => {
      // #46: this GET ADVANCES the cast-refs job with the ambient vivijure_token cookie; reject a
      // cross-site browser request so a malicious page can't drive it via CSRF.
      if (isCrossSiteRequest(c.req.raw)) throw forbidden(CSRF_ADVANCE_MSG);
      const castId = await resolveCastId(db(), c.req.param("id"));
      const job = await advanceCastRefsJob(oenv(), castId, c.req.param("jobId"));
      if (!job) throw notFound("cast refs job");
      return json({ ok: true, ...summarizeCastRefs(job) });
    }),
  );

  app.post("/api/cast/:id/train-lora", (c) =>
    handle(c, async () =>
      handleCastTrainLora(c.req.raw, oenv(), await resolveCastId(db(), c.req.param("id"))),
    ),
  );

  app.get("/api/cast/:id/lora-status", (c) =>
    handle(c, async () => handleCastLoraStatus(oenv(), await resolveCastId(db(), c.req.param("id")))),
  );

  // --- prefs ---
  app.get("/api/prefs", (c) =>
    handle(c, async () => json({ ok: true, prefs: await getUserPrefs(db()) })),
  );

  app.patch("/api/prefs", (c) =>
    handle(c, async () => {
      const body = await readBody<Record<string, unknown>>(c.req.raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw badRequest("body must be a prefs object");
      }
      const prefs = await setUserPrefs(db(), body);
      return json({ ok: true, prefs });
    }),
  );
}
