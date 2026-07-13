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
  } catch (e) {
    // #48: ONLY a genuinely-absent DB / migrations dir (ENOENT) is the legit process.env-only fallback
    // (first run / test). ANY other error -- a mid-migration failure, a locked or corrupt file, a
    // SQLITE_BUSY the busy_timeout could not outlast -- means the sidecar would boot MISCONFIGURED (no
    // DB-persisted operator secrets: RUNPOD_API_KEY, CF_AIG_TOKEN, S3 creds) and fail auth downstream
    // with no trace back to this boot-time hiccup. Log it and RETHROW so the boot fails loudly instead
    // of silently degrading to an env-only env.
    const code = (e as { code?: string }).code;
    if (code !== "ENOENT") {
      console.error(
        `loadModuleRuntimeEnv: SQLite load failed (${code ?? (e as Error).message}); ` +
          "refusing to boot with process.env-only secrets -- fix the DB and restart",
      );
      throw e;
    }
    console.warn(
      `loadModuleRuntimeEnv: no studio DB at ${dbPath} (ENOENT); using process.env-only secrets (first-run/test)`,
    );
    return RuntimeEnv.forTests(
      Object.fromEntries(
        Object.entries(process.env).map(([k, v]) => [k, v ?? undefined]),
      ) as Record<string, string | undefined>,
    );
  }
}
