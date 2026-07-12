export interface PlannerEnv {
  PLANNER_AI_MOCK?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
}

export function plannerEnvFromProcess(env: NodeJS.ProcessEnv = process.env): PlannerEnv {
  return {
    PLANNER_AI_MOCK: env.PLANNER_AI_MOCK,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    GATEWAY_ID: env.GATEWAY_ID,
    CF_AIG_TOKEN: env.CF_AIG_TOKEN,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  };
}

export function plannerEnvFromVars(vars: Record<string, string | undefined>): PlannerEnv {
  return {
    PLANNER_AI_MOCK: vars.PLANNER_AI_MOCK,
    CLOUDFLARE_ACCOUNT_ID: vars.CLOUDFLARE_ACCOUNT_ID,
    GATEWAY_ID: vars.GATEWAY_ID,
    CF_AIG_TOKEN: vars.CF_AIG_TOKEN,
    ANTHROPIC_API_KEY: vars.ANTHROPIC_API_KEY,
  };
}
