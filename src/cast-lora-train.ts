/** Cast LoRA training refresh stub (train-lora route is out of M5 scope). */

import type { CastMember } from "./cast-db.js";
import type { Env } from "@skyphusion-labs/vivijure-core/platform";

export async function refreshTrainingLora(_env: Env, cast: CastMember): Promise<CastMember> {
  return cast;
}
