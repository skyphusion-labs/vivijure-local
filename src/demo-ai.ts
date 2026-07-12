// Workers AI chat for AUTH_MODE=demo assistant (gateway Unified Billing).

import {
  aiGatewayConfig,
  gatewayJson,
  unifiedBillingHeaders,
} from "./platform/ai-gateway.js";
import type { PlannerEnv } from "./planner-env.js";
import { plannerAiMockEnabled, mockPlannerRaw } from "./planner-ai-mock.js";

const DEFAULT_DEMO_ASSISTANT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function extractWorkersAiText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as { response?: unknown; result?: { response?: unknown } };
    if (typeof r.response === "string") return r.response;
    if (typeof r.result?.response === "string") return r.result.response;
  }
  return "";
}

/** Demo assistant model seam (mirrors vivijure hDemoChat aiRun wrapper). */
export async function runDemoAssistantChat(
  env: PlannerEnv & { DEMO_ASSISTANT_MODEL?: string },
  args: { system: string; user: string; maxTokens: number },
): Promise<string> {
  if (plannerAiMockEnabled(env)) {
    return mockPlannerRaw(`[demo assistant mock] ${args.user}`).response.slice(0, args.maxTokens);
  }

  const model = (env.DEMO_ASSISTANT_MODEL || DEFAULT_DEMO_ASSISTANT_MODEL).trim();
  const gateway = aiGatewayConfig(env);
  if (!gateway) {
    throw new Error(
      "demo assistant requires GATEWAY_ID + CF_AIG_TOKEN + CLOUDFLARE_ACCOUNT_ID, or PLANNER_AI_MOCK=true",
    );
  }

  const url =
    `https://gateway.ai.cloudflare.com/v1/${gateway.accountId}/${gateway.gatewayId}` +
    `/workers-ai/${encodeURIComponent(model)}`;
  const { raw } = await gatewayJson(
    url,
    unifiedBillingHeaders(gateway),
    {
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      max_tokens: args.maxTokens,
    },
  );
  return extractWorkersAiText(raw);
}
