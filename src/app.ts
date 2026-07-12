// HTTP application (importable without listening).

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateApi } from "./auth-gate.js";
import { artifactKeyFromPath, handleServeArtifact, handleUpload } from "./artifacts.js";
import { httpErrorResponse } from "./errors.js";
import { authEnvFromPlatform } from "./http.js";
import type { ArtifactStore } from "./platform/create-storage.js";
import { isDemoMode } from "./auth-gate.js";
import { discoverModules, modulesResponse } from "@skyphusion-labs/vivijure-core";
import type { Platform } from "./platform/index.js";
import { moduleEnvFromPlatform } from "./platform/module-env.js";
import { registerM3Routes } from "./routes/m3.js";
import { registerM4Routes } from "./routes/m4-renders.js";
import { registerM5Routes } from "./routes/m5.js";
import { registerM6Routes } from "./routes/m6.js";
import { registerM7Routes } from "./routes/m7.js";
import { registerM9Routes } from "./routes/m9-render-api.js";
import { registerM10Routes } from "./routes/m10-chat.js";
import { registerM11DemoRoutes } from "./routes/m11-demo.js";
import { registerSettingsRoutes, type SettingsHost } from "./routes/m8-settings.js";
import { renderConfigProjection } from "@skyphusion-labs/vivijure-core/render-module-config";
import { resolveStudioPage } from "./studio-pages.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const repoRoot = join(__dirname, "..");

export function createApp(host: SettingsHost): Hono {
  const platform = host.platform;
  const authEnv = () => authEnvFromPlatform(platform);
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "vivijure-studio",
      phase: 3,
      storage: platform.vars.STORAGE_BACKEND ?? "unknown",
    }),
  );

  app.use("/api/*", async (c, next) => {
    const gate = await gateApi(c.req.raw, authEnv());
    if (!gate.ok) {
      return c.json({ error: gate.reason }, gate.status as 403 | 503);
    }
    await next();
  });

  app.get("/api/whoami", (c) => c.json({ user: "studio" }));

  app.get("/api/modules", async (c) => {
    const env = moduleEnvFromPlatform(platform);
    const modules = await discoverModules(env, { cacheTtlMs: 60_000 });
    return c.json(
      modulesResponse(modules, renderConfigProjection(), {
        dispatch: false,
        ...(isDemoMode(authEnv()) ? { readonly: true } : {}),
      }),
    );
  });

  const store = () => platform.renders as ArtifactStore;

  app.post("/api/upload", async (c) => {
    try {
      return await handleUpload(c.req.raw, store());
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  const serveArtifact = async (c: { req: { raw: Request; path: string; method: string } }) => {
    try {
      const key = artifactKeyFromPath(c.req.path);
      return await handleServeArtifact(c.req.raw, store(), key);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  };

  app.on(["GET", "HEAD"], "/api/artifact/*", serveArtifact);

  registerM3Routes(app, platform);
  registerM4Routes(app, platform);
  registerM5Routes(app, platform);
  registerM6Routes(app, platform);
  registerM7Routes(app, host);
  registerM9Routes(app, platform);
  registerM10Routes(app, host);
  registerM11DemoRoutes(app, platform);
  registerSettingsRoutes(app, host);

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
