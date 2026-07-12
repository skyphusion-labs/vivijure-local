/**
 * plan.enhance model layer (ported from vivijure/modules/plan-enhance/provider.ts).
 *
 * Model choice lives HERE, in the module -- not in core planner code. Opus via AI Gateway when
 * configured; otherwise Workers AI local open-weight. Swap the whole module worker to change stack.
 */
import {
  aiGatewayConfig,
  gatewayProviderBase,
  unifiedBillingHeaders,
} from "../../platform/ai-gateway.js";
import { plannerAiMockEnabled } from "../../planner-ai-mock.js";
import type { ChatMessage } from "./plan-enhance-core.js";

export const LOCAL_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_OPUS_MODEL = "claude-opus-4-8";

export interface ProviderEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ENHANCE_MODEL?: string;
  PLANNER_AI_MOCK?: string;
}

export type Provider = "opus" | "local";

function isAnthropicModelId(id: string): boolean {
  const s = id.trim();
  return s.startsWith("anthropic/") || s.startsWith("claude-");
}

/** Opus model id: explicit anthropic/claude-* override, else ENHANCE_MODEL, else default. */
export function opusModel(env: ProviderEnv, override?: string): string {
  const fromConfig = override?.trim();
  if (fromConfig && isAnthropicModelId(fromConfig)) {
    return fromConfig.replace(/^anthropic\//, "");
  }
  const m = env.ENHANCE_MODEL?.trim();
  return m && m.length > 0 ? m.replace(/^anthropic\//, "") : DEFAULT_OPUS_MODEL;
}

export function pickProvider(env: ProviderEnv, modelId?: string): Provider {
  if (modelId?.startsWith("@cf/")) return "local";
  return env.GATEWAY_ID?.trim() && env.CF_AIG_TOKEN?.trim() ? "opus" : "local";
}

export function toAnthropic(
  messages: ChatMessage[],
): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  let system: string | undefined;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    out.push({ role: "user", content: m.content });
  }
  return system ? { system, messages: out } : { messages: out };
}

export function extractAnthropicText(raw: unknown): string | null {
  const content = (raw as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((b): b is { type?: string; text?: string } => typeof b === "object" && b !== null)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  return text.trim().length > 0 ? text : null;
}

export async function callOpus(
  env: ProviderEnv,
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<string> {
  const cfg = aiGatewayConfig(env);
  if (!cfg) throw new Error("opus requires GATEWAY_ID, CF_AIG_TOKEN, and CLOUDFLARE_ACCOUNT_ID");
  const baseUrl = gatewayProviderBase(cfg, "anthropic");
  const { system, messages: aMessages } = toAnthropic(messages);

  const body: Record<string, unknown> = {
    model: opusModel(env, modelOverride),
    max_tokens: 4096,
    messages: aMessages,
  };
  if (system) body.system = system;

  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      ...unifiedBillingHeaders(cfg),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`anthropic ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const text = extractAnthropicText(await resp.json());
  if (!text) throw new Error("anthropic returned no text content");
  return text;
}

export async function callLocal(
  env: ProviderEnv,
  messages: ChatMessage[],
  modelId?: string,
): Promise<string | string[] | undefined> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CF_AIG_TOKEN?.trim() || env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) throw new Error("local model requires CLOUDFLARE_ACCOUNT_ID and a CF API token");

  const model = modelId?.trim() || LOCAL_MODEL;
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages }),
    },
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`workers ai ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { result?: { response?: string | string[] } };
  return data.result?.response;
}

export async function direct(
  env: ProviderEnv,
  messages: ChatMessage[],
  modelId?: string,
): Promise<{ reply: string | string[] | undefined; model: string }> {
  if (plannerAiMockEnabled(env)) {
    return { reply: undefined, model: "dev-mock" };
  }
  const localModel = modelId?.startsWith("@cf/") ? modelId : LOCAL_MODEL;
  if (pickProvider(env, modelId) === "opus") {
    try {
      return { reply: await callOpus(env, messages, modelId), model: opusModel(env, modelId) };
    } catch {
      return { reply: await callLocal(env, messages, localModel), model: `${localModel} (opus fell back)` };
    }
  }
  return { reply: await callLocal(env, messages, localModel), model: localModel };
}
