import type { Platform } from "../src/platform/types.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";
import type { SettingsHost } from "../src/routes/m8-settings.js";

/** Minimal SettingsHost for route tests (no DB-backed secrets). */
export function testSettingsHost(
  platform: Platform,
  overrides: Record<string, string | undefined> = {},
): SettingsHost {
  const runtime = RuntimeEnv.forTests({
    STUDIO_API_TOKEN: platform.vars.STUDIO_API_TOKEN,
    PLANNER_AI_MOCK: platform.vars.PLANNER_AI_MOCK ?? process.env.PLANNER_AI_MOCK,
    CLOUDFLARE_ACCOUNT_ID: platform.vars.CLOUDFLARE_ACCOUNT_ID,
    GATEWAY_ID: platform.vars.GATEWAY_ID,
    CF_AIG_TOKEN: platform.vars.CF_AIG_TOKEN,
    ANTHROPIC_API_KEY: platform.vars.ANTHROPIC_API_KEY,
    ...overrides,
  });
  platform.vars = {
    ...platform.vars,
    PLANNER_AI_MOCK: runtime.get("PLANNER_AI_MOCK"),
    CLOUDFLARE_ACCOUNT_ID: runtime.get("CLOUDFLARE_ACCOUNT_ID"),
    GATEWAY_ID: runtime.get("GATEWAY_ID"),
    CF_AIG_TOKEN: runtime.get("CF_AIG_TOKEN"),
    ANTHROPIC_API_KEY: runtime.get("ANTHROPIC_API_KEY"),
  };
  return {
    platform,
    runtime,
    publicBase: platform.vars.PUBLIC_BASE_URL ?? "http://127.0.0.1:8790",
  };
}
