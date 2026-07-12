// Boot the local studio HTTP server.

import "dotenv/config";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { createApp, repoRoot } from "./app.js";
import {
  createModuleTransport,
  createStorage,
  EnvSecretStore,
  migrateDatabase,
  openDatabase,
  type Platform,
} from "./platform/index.js";

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export function buildPlatform(): Platform {
  const dbPath = env("DATABASE_PATH", join(repoRoot, "data", "studio.db"))!;
  const port = env("PORT", "8790")!;
  const publicBase = env("PUBLIC_BASE_URL", `http://127.0.0.1:${port}`)!;
  const token = env("STUDIO_API_TOKEN");

  migrateDatabase(dbPath, join(repoRoot, "migrations"));

  const storage = createStorage(process.env, { publicBase, token });

  return {
    db: openDatabase(dbPath),
    renders: storage.renders,
    chatBucket: storage.chatBucket,
    presigner: storage.presigner,
    secrets: new EnvSecretStore(process.env),
    modules: createModuleTransport(process.env),
    vars: {
      AUTH_MODE: env("AUTH_MODE", "token"),
      STUDIO_API_TOKEN: token,
      ALLOW_UNAUTHENTICATED: env("ALLOW_UNAUTHENTICATED"),
      PUBLIC_BASE_URL: publicBase,
      PLANNER_AI_MOCK: env("PLANNER_AI_MOCK", "false"),
      STORAGE_BACKEND: storage.backend,
    },
  };
}

const platform = buildPlatform();
export const app = createApp(platform);

const port = Number(env("PORT", "8790"));
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`vivijure-local listening on http://127.0.0.1:${info.port}`);
  console.log(`  AUTH_MODE=${platform.vars.AUTH_MODE}`);
  console.log(`  storage=${platform.vars.STORAGE_BACKEND || "unknown"}`);
  console.log(`  modules bound: ${platform.modules.listBindings().join(", ") || "(none)"}`);
});

export { platform };
