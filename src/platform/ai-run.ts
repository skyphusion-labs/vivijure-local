// Workers AI + gateway run helpers (Node parity with vivijure env.AI.run).

import {
  aiGatewayConfig,
  gatewayJson,
  gatewayLogId,
  unifiedBillingHeaders,
  type AiGatewayEnv,
} from "./ai-gateway.js";

let lastGatewayLogId: string | null = null;

export function aiLogId(): string | null {
  return lastGatewayLogId;
}

function cfToken(env: AiGatewayEnv): string | null {
  return env.CF_AIG_TOKEN?.trim() || env.CLOUDFLARE_API_TOKEN?.trim() || null;
}

/** Mirrors vivijure aiRun(env, model, params). */
export async function aiRun(env: AiGatewayEnv, model: string, params: unknown): Promise<unknown> {
  lastGatewayLogId = null;
  const cfg = aiGatewayConfig(env);
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = cfToken(env);
  const encoded = encodeURIComponent(model);

  const multipart = (params as { multipart?: { body: ReadableStream; contentType: string } })?.multipart;
  if (multipart?.body && multipart.contentType) {
    if (!accountId || !token) {
      throw new Error("Workers AI multipart requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN");
    }
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encoded}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": multipart.contentType,
      },
      body: multipart.body as NonNullable<RequestInit["body"]>,
    });
    lastGatewayLogId = gatewayLogId(resp);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`workers ai ${resp.status}: ${errText.slice(0, 500)}`);
    }
    const data = (await resp.json()) as { result?: unknown };
    return data.result ?? data;
  }

  const useGateway = cfg && !model.startsWith("@cf/");
  if (useGateway) {
    const url =
      `https://gateway.ai.cloudflare.com/v1/${cfg.accountId}/${cfg.gatewayId}` +
      `/workers-ai/${encoded}`;
    const { raw, logId } = await gatewayJson(url, unifiedBillingHeaders(cfg), params);
    lastGatewayLogId = logId;
    return raw;
  }

  if (!accountId || !token) {
    throw new Error("Workers AI requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN (or CLOUDFLARE_API_TOKEN)");
  }

  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encoded}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(params),
  });
  lastGatewayLogId = gatewayLogId(resp);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`workers ai ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await resp.json()) as { result?: unknown };
  return data.result ?? data;
}
