// Best-effort shot durations from bundle tar (M5 stub: returns {} until full bundle-assembler port).

import type { Env } from "./orchestrator-env.js";

export async function readShotDurationsFromBundle(
  _env: Env,
  _bundleKey: string,
): Promise<Record<string, number>> {
  return {};
}
