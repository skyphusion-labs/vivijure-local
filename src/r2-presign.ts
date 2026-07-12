// Presign helpers for orchestrators (delegates to platform presigner).

import type { OrchestratorEnv } from "./orchestrator-env.js";
import { isPresignSafeKey } from "./shared.js";

export const FILM_DOWNLOAD_TTL_SECONDS = 3600;

export async function presignR2Get(env: OrchestratorEnv, key: string, expiresSec = 300): Promise<string> {
  if (!isPresignSafeKey(key)) throw new Error("R2 presign: refusing to sign an unsafe object key");
  return env.PRESIGNER.presignGet(key, expiresSec);
}

export async function presignR2Put(
  env: OrchestratorEnv,
  key: string,
  expiresSec = 300,
  contentType = "application/octet-stream",
): Promise<string> {
  if (!isPresignSafeKey(key)) throw new Error("R2 presign: refusing to sign an unsafe object key");
  return env.PRESIGNER.presignPut(key, contentType, expiresSec);
}
