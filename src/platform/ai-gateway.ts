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
 * Parity means the same FEATURE with an honest answer on each host, not the same bytes. Two things
 * differ, and both differ for the same reason: THE READER IS A DIFFERENT PERSON.
 *
 * 1. The knobs. cf is a Worker with an `AI` binding and `GATEWAY_ID`; a self-host studio has no
 *    Workers binding at all and is configured with these three environment variables. Shipping cf's
 *    text here would tell a homelabber to set something that does not exist on their machine.
 *
 * 2. The ACTION. cf says "ask whoever operates this studio", because a hosted tenant is overwhelmingly
 *    NOT the operator and cannot fix it themselves. On a self-host door the modal reader IS the
 *    operator -- their box, their .env, their compose file -- so that phrasing tells them to go ask
 *    themselves. This version gives the instruction directly. (Caught by Joan on review; the first
 *    draft kept the two strings parallel, which optimized for symmetry over the reader, and "write
 *    for the reader" was the whole point of the rewrite that produced the cf string in the first
 *    place. It still reads correctly to a non-operator on a shared LAN studio, who learns the studio
 *    needs configuring either way.)
 *
 * The two strings DIVERGING is correct and is NOT a parity violation: `public/` is the shared
 * surface, these live in `src/` per host. Unifying them into one identical string would be the
 * actual defect.
 *
 * Printed VERBATIM by the panel, so the text is the product. Change it here, never in the panel.
 */
export const PLANNER_UNAVAILABLE_REASON =
  "Storyboard planning is unavailable on this studio because its AI Gateway is not configured. " +
  "Set CLOUDFLARE_ACCOUNT_ID, GATEWAY_ID and CF_AIG_TOKEN to enable it.";

