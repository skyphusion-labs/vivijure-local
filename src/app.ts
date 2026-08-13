// HTTP application (importable without listening).

import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateApi } from "./auth-gate.js";
import {
  artifactKeyFromPath,
  artifactUrlKeyFromPath,
  handleArtifactUrl,
  handleServeArtifact,
  handleUpload,
} from "./artifacts.js";
import { handleRenderFrames } from "./render-frames.js";
import { httpErrorResponse } from "./errors.js";
import { authEnvFromPlatform } from "./http.js";
import type { ArtifactStore } from "./platform/create-storage.js";
import { isDemoMode } from "./auth-gate.js";
import { abuseReportUrl } from "./abuse-contact.js";
import { discoverConfiguredModules } from "./module-registry.js";
import { modulesResponse } from "@skyphusion-labs/vivijure-core";
import {
  checkStorageQuota,
  isStorageSubmitRoute,
  reconcileStorageUsage,
  storageQuotaBytes,
  storageUsage,
} from "@skyphusion-labs/vivijure-core/storage-quota";
import { wrapR2Bucket } from "@skyphusion-labs/vivijure-core/platform";
import type { Platform } from "./platform/index.js";
import { moduleEnvFromPlatform } from "./platform/module-env.js";
import { aiGatewayConfigured, PLANNER_UNAVAILABLE_REASON } from "./platform/ai-gateway.js";
import { registerM3Routes } from "./routes/m3.js";
import { registerM4Routes } from "./routes/m4-renders.js";
import { registerM5Routes } from "./routes/m5.js";
import { registerM6Routes } from "./routes/m6.js";
import { registerM7Routes } from "./routes/m7.js";
import { registerM9Routes } from "./routes/m9-render-api.js";
import { registerM10Routes } from "./routes/m10-chat.js";
import { registerM11DemoRoutes } from "./routes/m11-demo.js";
import { registerM12Routes } from "./routes/m12-planner-extra.js";
import { registerM13Routes } from "./routes/m13-render-history.js";
import { registerSettingsRoutes, type SettingsHost } from "./routes/m8-settings.js";
import { renderConfigProjection } from "@skyphusion-labs/vivijure-core/render-module-config";
import { resolveStudioPage } from "./studio-pages.js";
import { videoFinishHooksUnavailable } from "./video-finish-availability.js";
import { localDoorHooksUnavailable } from "./local-door-availability.js";

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

  // core#52 (vivijure-cf twin): the storage ceiling. Enforced at SUBMIT, before the spend, on the routes
  // whose product is stored bytes -- so an over-quota studio is denied honestly with the real numbers
  // instead of discovering it halfway through a film. Reads, deletes, the planner and chat keep working,
  // so the operator can go delete something. Registered AFTER the auth gate: an unauthenticated request
  // must never reach the ledger. The gated route list lives in core, so both panels gate the same
  // surface; R2_STORAGE_QUOTA_BYTES unset means this is a pure no-op that never touches the database.
  app.use("/api/*", async (c, next) => {
    if (isStorageSubmitRoute(c.req.method, new URL(c.req.url).pathname)) {
      const verdict = await checkStorageQuota({
        DB: platform.db,
        R2_STORAGE_QUOTA_BYTES: platform.vars.R2_STORAGE_QUOTA_BYTES,
      });
      if (!verdict.ok) return c.json({ error: verdict.message }, verdict.status as 503 | 507);
    }
    await next();
  });

  app.get("/api/whoami", (c) => c.json({ user: "studio" }));

  // core#52 operator surface (vivijure-cf twin). GET reports what the ledger says; POST rebuilds it from
  // the store, which is both the one-time backfill for a studio that predates accounting (artifact sizes
  // are not derivable from the DB, so the counter starts at 0) and the repair for drift from an
  // out-of-band delete or a failed ledger write.
  app.get("/api/storage/usage", async (c) => {
    const quotaBytes = storageQuotaBytes({ R2_STORAGE_QUOTA_BYTES: platform.vars.R2_STORAGE_QUOTA_BYTES });
    const { usedBytes, objects } = await storageUsage(platform.db);
    return c.json({
      used_bytes: usedBytes,
      objects,
      quota_bytes: quotaBytes,
      over: quotaBytes !== null && usedBytes >= quotaBytes,
    });
  });

  app.post("/api/storage/reconcile", async (c) => {
    const report = await reconcileStorageUsage(wrapR2Bucket(platform.renders), platform.db);
    // `unsized` counts objects the store would not report a size for: accounted as 0 and reported
    // honestly rather than folded into the total as a guess.
    return c.json({ objects: report.objects, bytes: report.bytes, unsized: report.unsized });
  });

  app.get("/api/modules", async (c) => {
    const env = moduleEnvFromPlatform(platform);
    const modules = await discoverConfiguredModules(env, { cacheTtlMs: 60_000 });
    // cf#98 parity: installed is not servable. A studio with the plan.enhance module installed but
    // no AI Gateway configured would otherwise serve a full planning-model picker whose every option
    // fails at hPlan -- the local#201 broken-button class. Absent key means available.
    // cf#118 parity: the video-finish tier is the second capability a host can genuinely lack, and
    // it rides the SAME channel rather than growing a parallel one. Merged, so a studio missing both
    // the gateway and the container reports both.
    const hooksUnavailable = {
      ...(aiGatewayConfigured(env as Parameters<typeof aiGatewayConfigured>[0])
        ? {}
        : { "plan.enhance": PLANNER_UNAVAILABLE_REASON }),
      // ASK THE PLATFORM, not the module env. moduleEnvFromPlatform deliberately does NOT copy
      // platform.hostBindings (only orchestratorContextFromPlatform does), so reading
      // env.VIDEO_FINISH_VPC here is always undefined and would report the tier missing on a
      // studio that has it running -- over-claiming, the failure direction that hides working
      // capability. hostBindings is where reload.ts puts the fetcher it builds from
      // VIDEO_FINISH_URL, so it is the authoritative answer to "can this host reach the tier".
      ...videoFinishHooksUnavailable({ VIDEO_FINISH_VPC: platform.hostBindings?.VIDEO_FINISH_VPC }),
      // local#229: with the GPU mock deleted, a studio with no door and no cloud module serves no
      // keyframe/motion engine at all. Say so here rather than let the panel offer controls whose
      // every option 400s at submit. Derived from the FILTERED module list, so a `cloud`-profile
      // studio with RunPod creds reports nothing.
      ...localDoorHooksUnavailable(modules),
    };
    const anyHookUnavailable = Object.keys(hooksUnavailable).length > 0;
    // control-plane#130 twin: where a reporter is sent for abuse of THIS studio. Absent unless the
    // operator set it, and the absence is the correct default rather than a gap -- this is the
    // self-host bundle, so there is no provider address to fall back to. See src/abuse-contact.ts.
    const abuseUrl = abuseReportUrl({ ABUSE_REPORT_URL: platform.vars.ABUSE_REPORT_URL });
    return c.json(
      modulesResponse(modules, renderConfigProjection(), {
        dispatch: false,
        ...(anyHookUnavailable ? { hooks_unavailable: hooksUnavailable } : {}),
        ...(abuseUrl ? { abuse_report_url: abuseUrl } : {}),
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

  // local#309 (cf#317 twin): turn an artifact KEY into a fetchable URL, so list_renders output_key /
  // keyframes[].key stop being dead ends on the self-host door too.
  const artifactUrl = async (c: { req: { raw: Request; path: string } }) => {
    try {
      const key = artifactUrlKeyFromPath(c.req.path);
      return await handleArtifactUrl(c.req.raw, store(), platform.presigner, key);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  };

  app.get("/api/artifact-url/*", artifactUrl);

  // local#311 (cf#322 / cf PR #324 twin): sample a rendered clip into a jpeg contact sheet stored as a
  // normal artifact, so a transport that can carry an image but not a video can actually SEE motion
  // output. Placed beside the artifact routes it was built to feed, same as local#309.
  app.post("/api/render/frames", async (c) => {
    try {
      return await handleRenderFrames(c.req.raw, platform);
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  registerM3Routes(app, platform);
  registerM4Routes(app, platform);
  registerM5Routes(app, platform);
  registerM6Routes(app, platform);
  registerM7Routes(app, host);
  registerM9Routes(app, platform);
  registerM10Routes(app, host);
  registerM11DemoRoutes(app, platform);
  registerM12Routes(app, platform);
  registerM13Routes(app, platform);
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
