// Demo studio routes: /api/demo/* (AUTH_MODE=demo only).

import type { Hono } from "hono";
import {
  DEFAULT_DEMO_RENDER_CAPS,
  listRenderables,
  pollDemoRender,
  submitDemoRender,
  type DemoBackend,
  type DemoRenderCaps,
  type D1Like,
} from "../demo-render.js";
import {
  runDemoChat,
  DEFAULT_DEMO_CHAT_CAPS,
  type DemoChatCaps,
  type DemoChatModel,
} from "../demo-chat.js";
import { isDemoMode } from "../auth-gate.js";
import { authEnvFromPlatform } from "../http.js";
import { readBody } from "../http.js";
import type { Platform } from "../platform/types.js";
import { badRequest, httpErrorResponse, notFound } from "../errors.js";
import { moduleEnvFromPlatform } from "../platform/module-env.js";
import {
  discoverModules,
  invokeModule,
  pollModule,
  resolveFetcher,
} from "@skyphusion-labs/vivijure-core";
import type { MotionBackendInput, MotionBackendOutput } from "@skyphusion-labs/vivijure-core/modules/types";
import { plannerEnvFromVars } from "../planner-env.js";
import { runDemoAssistantChat } from "../demo-ai.js";

function demoIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "global"
  );
}

function positiveIntVar(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

function demoRenderCaps(vars: Record<string, string | undefined>): DemoRenderCaps {
  return {
    ...DEFAULT_DEMO_RENDER_CAPS,
    perIpDaily: positiveIntVar(vars.DEMO_RENDER_PER_IP_DAILY, DEFAULT_DEMO_RENDER_CAPS.perIpDaily),
    globalDaily: positiveIntVar(vars.DEMO_RENDER_GLOBAL_DAILY, DEFAULT_DEMO_RENDER_CAPS.globalDaily),
    queueDepth: positiveIntVar(vars.DEMO_RENDER_QUEUE_DEPTH, DEFAULT_DEMO_RENDER_CAPS.queueDepth),
  };
}

function demoChatCaps(vars: Record<string, string | undefined>): DemoChatCaps {
  return {
    ...DEFAULT_DEMO_CHAT_CAPS,
    perIpDaily: positiveIntVar(vars.DEMO_CHAT_PER_IP_DAILY, DEFAULT_DEMO_CHAT_CAPS.perIpDaily),
    globalDaily: positiveIntVar(vars.DEMO_CHAT_GLOBAL_DAILY, DEFAULT_DEMO_CHAT_CAPS.globalDaily),
  };
}

async function demoRenderEnabled(platform: Platform): Promise<boolean> {
  if ((platform.vars.DEMO_RENDER_ENABLED || "").trim() !== "true") return false;
  const env = moduleEnvFromPlatform(platform);
  await discoverModules(env, { cacheTtlMs: 60_000 });
  return resolveFetcher(env, "MODULE_LOCAL_GPU") !== null;
}

function demoBackend(platform: Platform): DemoBackend {
  const env = moduleEnvFromPlatform(platform);
  return {
    async reachable() {
      return demoRenderEnabled(platform);
    },
    async submit(r, jobId) {
      const f = resolveFetcher(env, "MODULE_LOCAL_GPU");
      if (!f) return { ok: false, error: "local-gpu door not bound" };
      const input: MotionBackendInput = {
        shot_id: jobId,
        keyframe_url: r.keyframe_url,
        keyframe_key: r.keyframe_key,
        prompt: r.prompt,
        seconds: r.seconds,
      };
      const resp = await invokeModule<MotionBackendInput, MotionBackendOutput>(f, {
        hook: "motion.backend",
        input,
        config: { quality: r.quality },
        context: { project: "demo", job_id: jobId },
      });
      if (resp.ok && (resp as { pending?: boolean }).pending) {
        return { ok: true, poll: (resp as { poll: string }).poll };
      }
      if (!resp.ok) {
        return { ok: false, error: (resp as { error?: string }).error || "submit failed" };
      }
      return { ok: false, error: "local-gpu returned no poll token" };
    },
    async poll(token) {
      const f = resolveFetcher(env, "MODULE_LOCAL_GPU");
      if (!f) return { ok: false, error: "local-gpu door not bound" };
      const p = await pollModule<MotionBackendOutput>(f, { poll: token });
      if (p.ok && (p as { pending?: boolean }).pending) return { ok: true, pending: true };
      if (p.ok) {
        const clip = (p as { output: MotionBackendOutput }).output?.clip_key;
        return clip ? { ok: true, clipKey: clip } : { ok: false, error: "backend returned no clip_key" };
      }
      return { ok: false, error: (p as { error?: string }).error || "poll failed" };
    },
  };
}

function demoRenderDeps(platform: Platform) {
  const vars = platform.vars;
  const publicBase = (vars.PUBLIC_BASE_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
  const artifactOrigin = (vars.DEMO_ARTIFACT_ORIGIN || `${publicBase}/api/artifact`).replace(/\/$/, "");
  return {
    db: platform.db as unknown as D1Like,
    backend: demoBackend(platform),
    artifactOrigin,
    caps: demoRenderCaps(vars),
    now: Date.now(),
  };
}

function requireDemo(c: { json: (body: unknown, status?: number) => Response }, platform: Platform): Response | null {
  if (!isDemoMode(authEnvFromPlatform(platform))) {
    return c.json({ error: "not found" }, 404);
  }
  return null;
}

export function registerM11DemoRoutes(app: Hono, platform: Platform): void {
  app.get("/api/demo/menu", async (c) => {
    const denied = requireDemo(c, platform);
    if (denied) return denied;
    const scenes = await listRenderables(platform.db as unknown as D1Like);
    return c.json({ available: await demoRenderEnabled(platform), scenes });
  });

  app.post("/api/demo/render", async (c) => {
    const denied = requireDemo(c, platform);
    if (denied) return denied;
    try {
      const body = await readBody<{ scene?: string }>(c.req.raw);
      const r = await submitDemoRender(demoRenderDeps(platform), {
        renderableId: String(body.scene || ""),
        ip: demoIp(c.req.raw),
        jobId: crypto.randomUUID(),
      });
      if (!r.ok) {
        const status =
          r.reason === "paused" ? 503 : r.reason === "unknown-scene" ? 400 : 429;
        return c.json({ error: r.message, reason: r.reason }, status);
      }
      return c.json({
        jobId: r.jobId,
        status: r.status,
        position: r.position,
        waitSeconds: r.waitSeconds,
      });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });

  app.get("/api/demo/render/:id", async (c) => {
    const denied = requireDemo(c, platform);
    if (denied) return denied;
    const r = await pollDemoRender(demoRenderDeps(platform), c.req.param("id"));
    if (r.status === "not_found") throw notFound("render");
    return c.json(r);
  });

  app.post("/api/demo/chat", async (c) => {
    const denied = requireDemo(c, platform);
    if (denied) return denied;
    try {
      const body = await readBody<{ message?: string }>(c.req.raw);
      const plannerEnv = {
        ...plannerEnvFromVars(platform.vars),
        DEMO_ASSISTANT_MODEL: platform.vars.DEMO_ASSISTANT_MODEL,
      };
      const model: DemoChatModel = async ({ system, user, maxTokens }) =>
        runDemoAssistantChat(plannerEnv, { system, user, maxTokens });
      const r = await runDemoChat(
        {
          db: platform.db as unknown as D1Like,
          model,
          caps: demoChatCaps(platform.vars),
          now: Date.now(),
        },
        { ip: demoIp(c.req.raw), message: String(body.message || "") },
      );
      if (!r.ok) {
        const status = r.reason === "exhausted" ? 429 : r.reason === "error" ? 503 : 400;
        return c.json({ error: r.message, reason: r.reason, model: "oss" }, status);
      }
      return c.json({ reply: r.reply, model: "oss" });
    } catch (e) {
      const res = httpErrorResponse(e);
      if (res) return res;
      throw e;
    }
  });
}
