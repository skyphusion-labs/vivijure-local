import { createStorage } from "../../platform/create-storage.js";
import type { RunpodModuleEnv } from "../runpod/env.js";
import { stateKey, type RunState } from "./music-gen-core.js";

export async function readMusicState(env: RunpodModuleEnv, jobId: string): Promise<RunState | null> {
  const storage = createStorage(env as NodeJS.ProcessEnv);
  const buf = await storage.renders.get(stateKey(jobId));
  if (!buf) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as RunState;
  } catch {
    return null;
  }
}

export async function writeMusicState(env: RunpodModuleEnv, jobId: string, state: RunState): Promise<void> {
  const storage = createStorage(env as NodeJS.ProcessEnv);
  await storage.renders.put(stateKey(jobId), JSON.stringify(state), {
    httpMetadata: { contentType: "application/json" },
  });
}
