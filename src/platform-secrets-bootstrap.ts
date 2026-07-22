// Install / first-boot seeding: copy bootstrap env into platform_secrets when a key is not yet stored.
// DB values win after the first seed; env remains the fallback for keys never written.

import type { Database } from "./platform/types.js";
import { PLATFORM_SECRET_FIELDS } from "./platform-secrets-catalog.js";
import { listPlatformSecrets, upsertPlatformSecret } from "./platform-secrets-db.js";
import { isStudioApiTokenPlaceholder } from "./studio-token.js";

export { isStudioApiTokenPlaceholder, STUDIO_API_TOKEN_PLACEHOLDER } from "./studio-token.js";

/** Env keys install / compose may seed into platform_secrets (includes install-only studio token). */
export const PLATFORM_SECRET_BOOTSTRAP_KEYS: readonly string[] = [
  "STUDIO_API_TOKEN",
  ...PLATFORM_SECRET_FIELDS.map((f) => f.key),
];

export interface BootstrapPlatformSecretsResult {
  seeded: string[];
  skipped: string[];
}

/** Insert env values for bootstrap keys that are not already in platform_secrets. Never overwrites. */
export async function bootstrapPlatformSecretsFromEnv(
  db: Database,
  env: NodeJS.ProcessEnv,
): Promise<BootstrapPlatformSecretsResult> {
  const existing = await listPlatformSecrets(db);
  const seeded: string[] = [];
  const skipped: string[] = [];

  for (const key of PLATFORM_SECRET_BOOTSTRAP_KEYS) {
    if (existing.has(key)) {
      skipped.push(key);
      continue;
    }
    const value = (env[key] ?? "").trim();
    if (!value) {
      skipped.push(key);
      continue;
    }
    if (key === "STUDIO_API_TOKEN" && isStudioApiTokenPlaceholder(value)) {
      skipped.push(key);
      continue;
    }
    await upsertPlatformSecret(db, key, value);
    seeded.push(key);
  }

  return { seeded, skipped };
}
