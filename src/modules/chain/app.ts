import { Hono } from "hono";
import type {
  CastImageInput,
  DialogueInput,
  InvokeRequest,
  NotifyInput,
  PlanEnhanceInput,
  PollRequest,
  SpeechInput,
} from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import type { ChainModuleEnv } from "./chain-env.js";
import {
  invokeCastImage,
  invokeDialogueGen,
  invokeNotifyEmail,
  invokePlanEnhance,
  invokeSpeechUpscale,
  isChainModuleName,
  pollCastImage,
  pollDialogueGen,
  pollSpeechUpscale,
  type ChainModuleName,
} from "./handlers.js";

export function createChainModuleApp(
  manifest: Record<string, unknown>,
  moduleName: ChainModuleName,
  store: ArtifactStore,
  env: ChainModuleEnv,
): Hono {
  if (!isChainModuleName(moduleName)) {
    throw new Error(`unsupported chain module: ${moduleName}`);
  }

  const app = new Hono();
  const name = String(manifest.name ?? moduleName);

  app.get("/module.json", (c) => c.json(manifest));

  app.post("/invoke", async (c) => {
    let req: InvokeRequest;
    try {
      req = (await c.req.json()) as InvokeRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }

    if (moduleName === "plan-enhance") {
      if (req.hook !== "plan.enhance") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokePlanEnhance(env, req as InvokeRequest<PlanEnhanceInput>));
    }
    if (moduleName === "cast-image") {
      if (req.hook !== "cast.image") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeCastImage(store, req as InvokeRequest<CastImageInput>));
    }
    if (moduleName === "dialogue-gen") {
      if (req.hook !== "dialogue") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeDialogueGen(store, req as InvokeRequest<DialogueInput>));
    }
    if (moduleName === "speech-upscale") {
      if (req.hook !== "speech") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeSpeechUpscale(env, store, req as InvokeRequest<SpeechInput>));
    }
    if (req.hook !== "notify") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
    return c.json(await invokeNotifyEmail(req as InvokeRequest<NotifyInput>));
  });

  app.post("/poll", async (c) => {
    if (moduleName === "plan-enhance" || moduleName === "notify-email") {
      return c.json({ ok: false, error: `${name} does not support /poll` });
    }
    let body: PollRequest;
    try {
      body = (await c.req.json()) as PollRequest;
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" });
    }
    if (!body?.poll || typeof body.poll !== "string") {
      return c.json({ ok: false, error: "poll token required" });
    }
    if (moduleName === "cast-image") return c.json(await pollCastImage(store, body));
    if (moduleName === "dialogue-gen") return c.json(await pollDialogueGen(store, body));
    return c.json(await pollSpeechUpscale(env, body));
  });

  app.post("/cancel", (c) => c.json({ ok: false, error: `${name} does not support /cancel` }));

  return app;
}

export { isChainModuleName };
