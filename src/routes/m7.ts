// M7 routes: planner plan/refine + preflight.

import type { Hono } from "hono";
import { assembleBundle, type AssembleBundleArgs } from "@skyphusion-labs/vivijure-core/bundle-assembler";
import { listCast } from "@skyphusion-labs/vivijure-core/cast-db";
import { badRequest, httpErrorResponse } from "../errors.js";
import { json, readBody } from "../http.js";
import { discoverModules, resolveClipDurationFloor, servingForHook } from "@skyphusion-labs/vivijure-core";
import {
  checkCastBindingsReady,
  checkDurationGrid,
  checkStoryboardShape,
  resolveCastBindings,
  summarize,
  type PreflightIssue,
} from "@skyphusion-labs/vivijure-core/preflight";
import { moduleEnvFromPlatform } from "../platform/module-env.js";
import { orchestratorContextFromPlatform } from "@skyphusion-labs/vivijure-core/platform";
import type { SettingsHost } from "../routes/m8-settings.js";
import { plannerEnvFromVars } from "../planner-env.js";
import { dbEnvFromPlatform } from "../resolve-id.js";
import {
  planStoryboard,
  refineStoryboard,
  type PlanStoryboardArgs,
  type RefineStoryboardArgs,
} from "../planner.js";
import { validateStoryboard } from "@skyphusion-labs/vivijure-core/storyboard-validate";
import { dispatchChain } from "@skyphusion-labs/vivijure-core";
import type {
  PlanEnhanceInput,
  PlanEnhanceOutput,
  PlanEnhanceStoryboard,
} from "@skyphusion-labs/vivijure-core/modules/types";

async function handle(c: { req: { raw: Request } }, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const res = httpErrorResponse(e);
    if (res) return res;
    throw e;
  }
}

export function registerM7Routes(app: Hono, host: SettingsHost): void {
  const platform = host.platform;
  const plannerEnv = () => plannerEnvFromVars(platform.vars);

  app.post("/api/storyboard/preflight", (c) =>
    handle(c, async () => {
      const body = await readBody<unknown>(c.req.raw);
      const envelope = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

      const validated = validateStoryboard(envelope.storyboard);
      if (!validated.ok) {
        const issues: PreflightIssue[] = validated.errors.map((message) => ({
          level: "error",
          scope: "storyboard",
          message,
        }));
        return json(summarize(issues), 200);
      }

      const issues: PreflightIssue[] = [...checkStoryboardShape(validated.value)];
      const bindings =
        envelope.castBindings && typeof envelope.castBindings === "object"
          ? (envelope.castBindings as Record<string, unknown>)
          : null;

      if (bindings && Object.keys(bindings).length > 0) {
        const modEnv = moduleEnvFromPlatform(platform);
        const kfModules = servingForHook(
          await discoverModules(modEnv, { cacheTtlMs: 60_000 }),
          "keyframe",
        );
        const keyframeLabel =
          kfModules.map((m) => m.keyframe_label).find((l) => typeof l === "string" && l.trim()) ||
          "SDXL";
        const catalog = await listCast(dbEnvFromPlatform(platform));
        const { resolved, unresolved } = resolveCastBindings(bindings, catalog);
        issues.push(...unresolved);
        issues.push(...checkCastBindingsReady(resolved, catalog, keyframeLabel));
      }

      const motionBackend =
        typeof envelope.motionBackend === "string" ? envelope.motionBackend : null;
      if (motionBackend) {
        const quality = typeof envelope.quality === "string" ? envelope.quality : null;
        const modEnv = moduleEnvFromPlatform(platform);
        const motionModules = servingForHook(
          await discoverModules(modEnv, { cacheTtlMs: 60_000 }),
          "motion.backend",
        );
        const mod = motionModules.find((m) => m.name === motionBackend);
        if (mod?.duration_grid) {
          const floorFraction = resolveClipDurationFloor(
            platform.vars.FILM_CLIP_DURATION_FLOOR as string | undefined,
          );
          issues.push(
            ...checkDurationGrid(
              validated.value,
              mod.duration_grid,
              quality,
              mod.name,
              floorFraction,
            ),
          );
        }
      }

      return json(summarize(issues), 200);
    }),
  );

  app.post("/api/storyboard/plan", (c) =>
    handle(c, async () => {
      const args = await readBody<PlanStoryboardArgs>(c.req.raw);
      if (!args.brief || !args.model) throw badRequest("brief and model required");
      if (!Array.isArray(args.characters)) args.characters = [];
      const result = await planStoryboard(plannerEnv(), args);
      return json(result, result.ok ? 200 : 422);
    }),
  );

  app.post("/api/storyboard/refine", (c) =>
    handle(c, async () => {
      const args = await readBody<RefineStoryboardArgs>(c.req.raw);
      if (args.storyboard === undefined || !args.message || !args.model) {
        throw badRequest("storyboard, message, model required");
      }
      const result = await refineStoryboard(plannerEnv(), args);
      return json(result, result.ok ? 200 : 422);
    }),
  );

  app.post("/api/storyboard/bundle", (c) =>
    handle(c, async () => {
      const args = await readBody<AssembleBundleArgs>(c.req.raw);
      if (!args.storyboard || !args.characterRefs) {
        throw badRequest("storyboard and characterRefs required");
      }
      const env = orchestratorContextFromPlatform(platform);
      const result = await assembleBundle(env, args);
      return json(result, result.ok ? 201 : 400);
    }),
  );

  app.post("/api/storyboard/enhance", (c) =>
    handle(c, async () => {
      const a = await readBody<{
        storyboard?: PlanEnhanceStoryboard;
        brief?: string;
        project?: string;
        config?: Record<string, unknown>;
      }>(c.req.raw);
      if (!a.storyboard || !Array.isArray(a.storyboard.scenes)) {
        throw badRequest("storyboard with scenes required");
      }
      const modEnv = moduleEnvFromPlatform(platform);
      const envRec = modEnv as unknown as Record<string, unknown>;
      const modules = await discoverModules(envRec, { cacheTtlMs: 60_000 });
      const seed: PlanEnhanceInput = { storyboard: a.storyboard, brief: a.brief };
      const result = await dispatchChain<PlanEnhanceInput, PlanEnhanceOutput>(
        envRec,
        modules,
        "plan.enhance",
        seed,
        { project: a.project || "enhance", job_id: crypto.randomUUID() },
        {
          nextInput: (prev) => ({ storyboard: prev.storyboard, brief: a.brief }),
          configFor: () => a.config,
        },
      );
      return json({
        ok: true,
        storyboard: result.output?.storyboard ?? a.storyboard,
        applied: result.applied,
        errors: result.errors,
        notes: result.output?.notes ?? [],
      });
    }),
  );
}
