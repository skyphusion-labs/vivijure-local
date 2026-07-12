import { getCastIdByPublicId } from "./cast-db.js";
import type { DbEnv } from "./db-env.js";
import { notFound } from "./errors.js";
import { isPublicId } from "./public-id.js";
import { getProjectIdByPublicId } from "./storyboard-projects-db.js";

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

export function dbEnvFromPlatform(platform: { db: DbEnv["DB"] }): DbEnv {
  return { DB: platform.db };
}
