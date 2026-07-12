import { createStorage } from "../../platform/create-storage.js";
import type { RunpodModuleEnv } from "./env.js";

export async function putClipBytes(
  env: RunpodModuleEnv,
  clipKey: string,
  bytes: Uint8Array,
): Promise<void> {
  const storage = createStorage(env as NodeJS.ProcessEnv);
  await storage.renders.put(clipKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
}

export async function putAudioBytes(
  env: RunpodModuleEnv,
  audioKey: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const storage = createStorage(env as NodeJS.ProcessEnv);
  await storage.renders.put(audioKey, bytes, { httpMetadata: { contentType } });
}
