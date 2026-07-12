import { getCastIdByPublicId } from "@skyphusion-labs/vivijure-core/cast-db";
import type { DbEnv } from "@skyphusion-labs/vivijure-core/db-env";
import { getRenderIdByPublicId } from "@skyphusion-labs/vivijure-core/renders-db";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { notFound } from "./errors.js";
import { isPublicId } from "@skyphusion-labs/vivijure-core/public-id";
import { getProjectIdByPublicId } from "@skyphusion-labs/vivijure-core/storyboard-projects-db";

export async function resolveProjectId(env: DbEnv, raw: string): Promise<number> {
  if (!isPublicId(raw)) throw notFound("project");
  const id = await getProjectIdByPublicId(env, raw);
  if (id === null) throw notFound("project");
  return id;
}

export async function resolveCastId(env: DbEnv, raw: string): Promise<number> {
  if (!isPublicId(raw)) throw notFound("cast member");
  const id = await getCastIdByPublicId(env, raw);
  if (id === null) throw notFound("cast member");
  return id;
}

export async function resolveRenderId(env: OrchestratorEnv, raw: string): Promise<number> {
  if (!isPublicId(raw)) throw notFound("render");
  const id = await getRenderIdByPublicId(env, raw);
  if (id === null) throw notFound("render");
  return id;
}

export function dbEnvFromPlatform(platform: { db: DbEnv["DB"] }): DbEnv {
  return { DB: platform.db };
}
