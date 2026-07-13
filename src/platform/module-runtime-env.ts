// Module sidecars share the studio SQLite DB so operator secrets (Settings / platform_secrets)
// reach RunPod, AI Gateway, and S3 bindings without a separate compose env copy per container.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeEnv } from "./runtime-env.js";
import { migrateDatabase, openDatabase } from "./sqlite.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

function defaultDatabasePath(): string {
  return process.env.DATABASE_PATH?.trim() || join(repoRoot, "data", "studio.db");
}

/** Load merged env (process + platform_secrets). Falls back to process.env when DB is absent. */
export async function loadModuleRuntimeEnv(): Promise<RuntimeEnv> {
  const dbPath = defaultDatabasePath();
  try {
    migrateDatabase(dbPath, join(repoRoot, "migrations"));
    const db = openDatabase(dbPath);
    return RuntimeEnv.load(process.env, db);
  } catch {
    return RuntimeEnv.forTests(
      Object.fromEntries(
        Object.entries(process.env).map(([k, v]) => [k, v ?? undefined]),
      ) as Record<string, string | undefined>,
    );
  }
}
