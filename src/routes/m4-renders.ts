// M4 routes: render library CRUD.

import type { Hono } from "hono";
import {
  DEFAULT_RENDERS_LIMIT,
  deleteRenderRow,
  getRenderByIdForUser,
  listRendersForUser,
  normalizeFolderPath,
  normalizeLockedShots,
  normalizeTags,
  setRenderFolder,
  setRenderLabel,
  setRenderLockedShots,
  setRenderTags,
  toPublicRenderRow,
} from "@skyphusion-labs/vivijure-core/renders-db";
import { isPublicId } from "@skyphusion-labs/vivijure-core/public-id";
import { getProjectIdByPublicId } from "@skyphusion-labs/vivijure-core/storyboard-projects-db";
import type { DbEnv } from "@skyphusion-labs/vivijure-core/db-env";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import { httpErrorResponse, notFound } from "../errors.js";
import { json, readBody } from "../http.js";
import type { Platform } from "../platform/types.js";
import { dbEnvFromPlatform, resolveRenderId } from "../resolve-id.js";

async function resolveProjectRef(env: DbEnv, raw: string | null): Promise<number | null> {
  if (!raw || !isPublicId(raw)) return null;
  return getProjectIdByPublicId(env, raw);
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

export function registerM4Routes(app: Hono, platform: Platform): void {
  const db = () => dbEnvFromPlatform(platform);
  const env = () => orchestratorContextFromPlatform(platform);

  app.get("/api/storyboard/renders", (c) =>
    handle(c, async () => {
      const url = new URL(c.req.raw.url);
      const projectId = await resolveProjectRef(db(), url.searchParams.get("project_id"));
      const limitParam = url.searchParams.get("limit");
      const limitNum =
        limitParam === null || limitParam.trim() === "" ? DEFAULT_RENDERS_LIMIT : Number(limitParam);
      const limit = Number.isFinite(limitNum) ? limitNum : DEFAULT_RENDERS_LIMIT;
      const renders = await listRendersForUser(env(), limit, projectId);
      return json({ renders: renders.map(toPublicRenderRow) });
    }),
  );

  app.patch("/api/storyboard/renders/:id", (c) =>
    handle(c, async () => {
      const id = await resolveRenderId(env(), c.req.param("id"));
      const b = await readBody<{
        label?: string | null;
        lockedShots?: unknown;
        folderPath?: unknown;
        tags?: unknown;
      }>(c.req.raw);
      let ok = false;
      if ("label" in b) ok = (await setRenderLabel(env(), id, b.label ?? null)) || ok;
      if ("lockedShots" in b) {
        ok = (await setRenderLockedShots(env(), id, normalizeLockedShots(b.lockedShots))) || ok;
      }
      if ("folderPath" in b) ok = (await setRenderFolder(env(), id, normalizeFolderPath(b.folderPath))) || ok;
      if ("tags" in b) ok = (await setRenderTags(env(), id, normalizeTags(b.tags))) || ok;
      if (!ok) throw notFound("render");
      const updated = await getRenderByIdForUser(env(), id);
      return json(updated ? toPublicRenderRow(updated) : null);
    }),
  );

  app.delete("/api/storyboard/renders/:id", (c) =>
    handle(c, async () => {
      if (!(await deleteRenderRow(env(), await resolveRenderId(env(), c.req.param("id"))))) {
        throw notFound("render");
      }
      return json({ ok: true });
    }),
  );
}
