// HTTP application (importable without listening).

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateApi } from "./auth-gate.js";
import { authEnvFromPlatform } from "./http.js";
import type { Platform } from "./platform/index.js";
import { resolveStudioPage } from "./studio-pages.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const repoRoot = join(__dirname, "..");

export function createApp(platform: Platform): Hono {
  const authEnv = () => authEnvFromPlatform(platform);
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "vivijure-studio", phase: 1 }));

  app.use("/api/*", async (c, next) => {
    const gate = await gateApi(c.req.raw, authEnv());
    if (!gate.ok) {
      return c.json({ error: gate.reason }, gate.status as 403 | 503);
    }
    await next();
  });

  app.get("/api/whoami", (c) => c.json({ user: "studio" }));

  app.get("/api/modules", (c) =>
    c.json({
      api: "vivijure-module/2",
      modules: [],
      hooks: {},
      catalog: [],
      render: { quality_tiers: [], default_tier: "final" },
      host: { edition: "local" },
    }),
  );

  app.get("*", async (c, next) => {
    const asset = resolveStudioPage(c.req.path);
    if (asset && (c.req.method === "GET" || c.req.method === "HEAD")) {
      return serveStatic({ root: join(repoRoot, "public"), path: asset })(c, next);
    }
    await next();
  });

  app.use("/*", serveStatic({ root: join(repoRoot, "public") }));

  return app;
}
