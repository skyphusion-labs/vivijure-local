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
import type { ImageGenerateInput } from "./image-generate-core.js";
import {
  invokeCastImage,
  invokeImageGenerate,
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

export interface ChainModuleContext {
  env: ChainModuleEnv;
  store: ArtifactStore;
}

export function createChainModuleApp(
  manifest: Record<string, unknown>,
  moduleName: ChainModuleName,
  getContext: () => Promise<ChainModuleContext>,
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

    const { env, store } = await getContext();
    if (moduleName === "plan-enhance") {
      if (req.hook !== "plan.enhance") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokePlanEnhance(env, req as InvokeRequest<PlanEnhanceInput>));
    }
    if (moduleName === "cast-image") {
      if (req.hook !== "cast.image") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeCastImage(store, req as InvokeRequest<CastImageInput>));
    }
    if (moduleName === "image-generate") {
      if (req.hook !== "image.generate") return c.json({ ok: false, error: "unsupported hook " + String(req.hook) });
      return c.json(await invokeImageGenerate(env, req as InvokeRequest<ImageGenerateInput>));
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
    const { env, store } = await getContext();
    if (moduleName === "cast-image") return c.json(await pollCastImage(env, store, body));
    if (moduleName === "dialogue-gen") return c.json(await pollDialogueGen(store, body));
    return c.json(await pollSpeechUpscale(env, body));
  });

  app.post("/cancel", (c) => c.json({ ok: false, error: `${name} does not support /cancel` }));

  return app;
}

export { isChainModuleName };
