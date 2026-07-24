// Cloudflare AI Gateway HTTP helpers (Node host parity with Workers env.AI.gateway()).

const GATEWAY_HOST = "https://gateway.ai.cloudflare.com";

export interface AiGatewayConfig {
  accountId: string;
  gatewayId: string;
  aigToken: string;
}

export interface AiGatewayEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

/** True when Unified Billing / gateway routing is configured (same gate as upstream plan-enhance). */
export function aiGatewayConfigured(env: AiGatewayEnv): boolean {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      env.GATEWAY_ID?.trim() &&
      env.CF_AIG_TOKEN?.trim(),
  );
}

export function aiGatewayConfig(env: AiGatewayEnv): AiGatewayConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = env.GATEWAY_ID?.trim();
  const aigToken = env.CF_AIG_TOKEN?.trim();
  if (!accountId || !gatewayId || !aigToken) return null;
  return { accountId, gatewayId, aigToken };
}

/** Mirrors env.AI.gateway(id).getUrl(provider) from the Workers binding. */
export function gatewayProviderBase(cfg: AiGatewayConfig, provider: string): string {
  const slug = provider.replace(/\/$/, "");
  return `${GATEWAY_HOST}/v1/${cfg.accountId}/${cfg.gatewayId}/${slug}`;
}

/** OpenAI-compatible unified path (Workers AI + proxied OpenAI/Google/xAI). */
export function gatewayCompatBase(cfg: AiGatewayConfig): string {
  return `${GATEWAY_HOST}/v1/${cfg.accountId}/${cfg.gatewayId}/compat`;
}

/** Unified Billing auth header. Never pair with provider BYOK keys on Anthropic. */
export function unifiedBillingHeaders(cfg: AiGatewayConfig): Record<string, string> {
  return {
    "cf-aig-authorization": `Bearer ${cfg.aigToken}`,
    "content-type": "application/json",
  };
}

export function gatewayLogId(resp: Response): string | null {
  return resp.headers.get("cf-aig-log-id");
}

export async function gatewayJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ raw: unknown; logId: string | null }> {
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const logId = gatewayLogId(resp);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI Gateway ${resp.status}: ${errText.slice(0, 500)}`);
  }
  return { raw: await resp.json(), logId };
}

/**
 * Why this string is NOT byte-identical to vivijure-cf's (vivijure-cf#98).
 *
 * Parity means the same FEATURE with an honest answer on each host, not the same bytes. The leading
 * sentence and the "ask whoever operates this studio" action are deliberately identical, because
 * that half is about the reader. The parenthetical names the knobs, and the knobs genuinely differ:
 * cf is a Worker with an `AI` binding and `GATEWAY_ID`; a self-host studio has no Workers binding at
 * all and is configured with these three environment variables instead. Shipping cf's text here
 * would tell a homelabber to set a binding that does not exist on their machine -- accurate-looking
 * and useless, which is the failure this whole issue is about.
 *
 * Printed VERBATIM by the panel, so the text is the product. Change it here, never in the panel.
 */
export const PLANNER_UNAVAILABLE_REASON =
  "Storyboard planning is unavailable on this studio because its AI Gateway is not configured. " +
  "Ask whoever operates this studio to enable it (CLOUDFLARE_ACCOUNT_ID, GATEWAY_ID and CF_AIG_TOKEN).";

