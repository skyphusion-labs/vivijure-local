// Settings routes: module install config + platform secrets (GUI-first operator surface).

import type { Hono } from "hono";
import { discoverModules } from "@skyphusion-labs/vivijure-core";
import {
  hasInstallConfig,
  installFieldKeys,
  loadInstallConfig,
  setInstallConfig,
} from "@skyphusion-labs/vivijure-core/operator-config";
import { badRequest, httpErrorResponse, notFound } from "../errors.js";
import { json, readBody } from "../http.js";
import { moduleEnvFromPlatform } from "../platform/module-env.js";
import { applyRuntimeEnvToPlatform, maskSecretValue } from "../platform/reload.js";
import type { RuntimeEnv } from "../platform/runtime-env.js";
import type { Platform } from "../platform/types.js";
import {
  PLATFORM_SECRET_CATEGORIES,
  PLATFORM_SECRET_FIELDS,
  platformSecretField,
  PLATFORM_SECRET_INSTALL_ONLY,
} from "../platform-secrets-catalog.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";

export interface SettingsHost {
  platform: Platform;
  runtime: RuntimeEnv;
  publicBase: string;
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

export function registerSettingsRoutes(app: Hono, host: SettingsHost): void {
  const { platform, runtime } = host;

  app.get("/api/modules/:name/config", (c) =>
    handle(c, async () => {
      const name = c.req.param("name");
      const env = orchestratorContextFromPlatform(platform);
      const modules = await discoverModules(moduleEnvFromPlatform(platform), { cacheTtlMs: 0 });
      const mod = modules.find((m) => m.name === name);
      if (!mod) throw notFound(`module ${name} not installed`);
      if (!hasInstallConfig(mod.config_schema)) {
        return json({ module: name, config: {} });
      }
      const config = await loadInstallConfig(env, name, mod.config_schema);
      return json({ module: name, config });
    }),
  );

  app.patch("/api/modules/:name/config", (c) =>
    handle(c, async () => {
      const name = c.req.param("name");
      const body = await readBody<Record<string, unknown>>(c.req.raw);
      const env = orchestratorContextFromPlatform(platform);
      const modules = await discoverModules(moduleEnvFromPlatform(platform), { cacheTtlMs: 0 });
      const mod = modules.find((m) => m.name === name);
      if (!mod) throw notFound(`module ${name} not installed`);
      if (!hasInstallConfig(mod.config_schema)) {
        throw badRequest(`module ${name} has no install-scope settings`);
      }
      const allowed = new Set(installFieldKeys(mod.config_schema));
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body ?? {})) {
        if (!allowed.has(key)) continue;
        patch[key] = value;
      }
      const config = await setInstallConfig(env, name, mod.config_schema, patch);
      return json({ module: name, config });
    }),
  );

  app.get("/api/settings/secrets", (c) =>
    handle(c, async () => {
      const fields = PLATFORM_SECRET_FIELDS.map((def) => {
        const raw = runtime.get(def.key);
        const source = runtime.source(def.key);
        const configured = source !== "unset";
        return {
          key: def.key,
          label: def.label,
          blurb: def.blurb,
          category: def.category,
          sensitive: def.sensitive,
          applies_on: def.applies_on,
          configured,
          source: source === "unset" ? null : source,
          display: configured && raw ? maskSecretValue(raw, def.sensitive) : "",
        };
      });
      return json({
        categories: PLATFORM_SECRET_CATEGORIES,
        fields,
        hint: "Provider and connection keys (storage, AI Gateway, RunPod, module URLs). Studio login is install-seeded and not editable here.",
      });
    }),
  );

  app.patch("/api/settings/secrets", (c) =>
    handle(c, async () => {
      const body = await readBody<{ values?: Record<string, string | null> }>(c.req.raw);
      const values = body.values;
      if (!values || typeof values !== "object") throw badRequest("values object required");

      const applied: string[] = [];
      const cleared: string[] = [];
      let restartRecommended = false;

      for (const [key, value] of Object.entries(values)) {
        if (PLATFORM_SECRET_INSTALL_ONLY.has(key)) continue;
        const def = platformSecretField(key);
        if (!def) continue;
        if (value === null || value === "") {
          await runtime.clear(platform.db, key);
          cleared.push(key);
          continue;
        }
        if (typeof value !== "string") throw badRequest(`${key} must be a string`);
        await runtime.set(platform.db, key, value.trim());
        applied.push(key);
        if (def.applies_on === "restart") restartRecommended = true;
      }

      applyRuntimeEnvToPlatform(platform, runtime, { publicBase: host.publicBase });

      return json({
        ok: true,
        applied,
        cleared,
        restart_recommended: restartRecommended,
        message: restartRecommended
          ? "Saved. Storage settings were reloaded; restart the studio container if your deployment still injects secrets only from .env at boot."
          : "Saved and applied.",
      });
    }),
  );
}
