import { Hono } from "hono";
import type {
  FilmFinishInput,
  InvokeRequest,
  MasterInput,
  PollRequest,
  ScoreInput,
} from "../types.js";
import {
  invokeAudioMaster,
  invokeBeatSync,
  invokeFilmTitles,
  invokeSubtitle,
  isCpuModuleName,
  pollFilmTitles,
  pollSubtitle,
  type CpuModuleName,
} from "./handlers.js";
import type { CpuModuleEnv } from "./vpc-env.js";

export function createCpuModuleApp(
  manifest: Record<string, unknown>,
  moduleName: string,
  env: CpuModuleEnv,
): Hono {
  if (!isCpuModuleName(moduleName)) {
    throw new Error(`unsupported CPU module: ${moduleName}`);
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

    const hook = req.hook;
    if (moduleName === "beat-sync") {
      if (hook !== "score") return c.json({ ok: false, error: "unsupported hook " + String(hook) });
      return c.json(await invokeBeatSync(env, req as InvokeRequest<ScoreInput>));
    }
    if (moduleName === "audio-master") {
      if (hook !== "master") return c.json({ ok: false, error: "unsupported hook " + String(hook) });
      return c.json(await invokeAudioMaster(env, req as InvokeRequest<MasterInput>));
    }
    if (moduleName === "film-titles" || moduleName === "subtitle") {
      if (hook !== "film.finish") return c.json({ ok: false, error: "unsupported hook " + String(hook) });
      const typed = req as InvokeRequest<FilmFinishInput>;
      const result =
        moduleName === "film-titles"
          ? await invokeFilmTitles(env, typed)
          : await invokeSubtitle(env, typed);
      return c.json(result);
    }
    return c.json({ ok: false, error: `${name}: not implemented` });
  });

  app.post("/poll", async (c) => {
    if (moduleName !== "film-titles" && moduleName !== "subtitle") {
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
    const result =
      moduleName === "film-titles"
        ? await pollFilmTitles(env, body)
        : await pollSubtitle(env, body);
    return c.json(result);
  });

  app.post("/cancel", (c) =>
    c.json({ ok: false, error: `${name} does not support /cancel` }),
  );

  return app;
}

export type { CpuModuleName };
