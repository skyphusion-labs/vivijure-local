// Planner providers: Anthropic via AI Gateway (Unified Billing) or direct BYOK.

import type { ModelEntry } from "./models.js";
import {
  aiGatewayConfig,
  gatewayJson,
  gatewayProviderBase,
  unifiedBillingHeaders,
} from "./platform/ai-gateway.js";
import type { PlannerEnv } from "./planner-env.js";

function anthropicMessages(
  systemPrompt: string | undefined,
  messages: Array<unknown>,
): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  let system = systemPrompt?.trim() || undefined;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown };
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : "";
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = typeof m.content === "string" ? m.content : "";
    if (content) out.push({ role, content });
  }
  return system ? { system, messages: out } : { messages: out };
}

/** Anthropic: gateway Unified Billing first (upstream default), direct BYOK second. */
export async function callAnthropic(
  env: PlannerEnv,
  model: ModelEntry,
  systemPrompt: string | undefined,
  messages: Array<unknown>,
): Promise<{ raw: unknown; logId: string | null }> {
  const modelName = model.id.replace(/^anthropic\//, "");
  const gateway = aiGatewayConfig(env);

  if (gateway) {
    const base = gatewayProviderBase(gateway, "anthropic");
    const { system, messages: aMessages } = anthropicMessages(systemPrompt, messages);
    const body: Record<string, unknown> = {
      model: modelName,
      max_tokens: 4096,
      messages: aMessages,
    };
    if (system) body.system = system;
    return gatewayJson(`${base}/v1/messages`, {
      ...unifiedBillingHeaders(gateway),
      "anthropic-version": "2023-06-01",
    }, body);
  }

  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Anthropic planning requires GATEWAY_ID + CF_AIG_TOKEN + CLOUDFLARE_ACCOUNT_ID (Unified Billing) " +
        "or ANTHROPIC_API_KEY (BYOK), or set PLANNER_AI_MOCK=true",
    );
  }

  const { system, messages: aMessages } = anthropicMessages(systemPrompt, messages);
  const body: Record<string, unknown> = {
    model: modelName,
    max_tokens: 4096,
    messages: aMessages,
  };
  if (system) body.system = system;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  return { raw: await resp.json(), logId: null };
}
