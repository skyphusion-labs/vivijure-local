import type { PlannerEnv } from "../../planner-env.js";
import { plannerEnvFromProcess } from "../../planner-env.js";

export type ChainModuleEnv = PlannerEnv & {
  CLOUDFLARE_API_TOKEN?: string;
  ENHANCE_MODEL?: string;
};

export function chainModuleEnvFromProcess(processEnv: NodeJS.ProcessEnv = process.env): ChainModuleEnv {
  return {
    ...plannerEnvFromProcess(processEnv),
    CLOUDFLARE_API_TOKEN: processEnv.CLOUDFLARE_API_TOKEN,
    ENHANCE_MODEL: processEnv.ENHANCE_MODEL,
  };
}
