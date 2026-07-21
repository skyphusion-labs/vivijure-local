// Workers AI + gateway run helpers (Node parity with vivijure env.AI.run).

import {
  aiGatewayConfig,
  gatewayLogId,
  type AiGatewayEnv,
} from "./ai-gateway.js";

let lastGatewayLogId: string | null = null;

export function aiLogId(): string | null {
  return lastGatewayLogId;
}

function cfToken(env: AiGatewayEnv): string | null {
  return env.CF_AIG_TOKEN?.trim() || env.CLOUDFLARE_API_TOKEN?.trim() || null;
}

/** Path endpoint uses literal slashes in @cf/author/model (do not encodeURIComponent the whole id). */
function workersAiPath(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}

function unifiedRunUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
}

async function parseWorkersAiResponse(resp: Response): Promise<unknown> {
  lastGatewayLogId = gatewayLogId(resp);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`workers ai ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const ct = resp.headers.get("content-type") ?? "";
  // TTS / image models return binary (audio/mpeg, audio/wav, image/*). The unified JSON envelope
  // is for text models only; Aura-1 on the path endpoint never wraps bytes in { result }.
  if (!ct.includes("application/json")) {
    return resp.arrayBuffer();
  }
  const data = (await resp.json()) as { result?: unknown };
  return data.result ?? data;
}

/** Mirrors vivijure aiRun(env, model, params). */
export async function aiRun(env: AiGatewayEnv, model: string, params: unknown): Promise<unknown> {
  lastGatewayLogId = null;
  const cfg = aiGatewayConfig(env);
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = cfToken(env);

  const formData = (params as { formData?: FormData })?.formData;
  if (formData) {
    if (!accountId || !token) {
      throw new Error("Workers AI multipart requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN");
    }
    // FLUX-2 multipart on the path endpoint. cf-aig-gateway-id breaks this path (CF API quirk).
    const resp = await fetch(workersAiPath(accountId, model), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    return parseWorkersAiResponse(resp);
  }

  const multipart = (params as { multipart?: { body: ReadableStream; contentType: string } })?.multipart;
  if (multipart?.body && multipart.contentType) {
    if (!accountId || !token) {
      throw new Error("Workers AI multipart requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN");
    }
    const resp = await fetch(workersAiPath(accountId, model), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": multipart.contentType,
      },
      body: multipart.body as NonNullable<RequestInit["body"]>,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return parseWorkersAiResponse(resp);
  }

  if (cfg) {
    if (!accountId || !token) {
      throw new Error("Workers AI requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN (or CLOUDFLARE_API_TOKEN)");
    }
    // Gateway-routed Workers AI uses the per-model path endpoint + cf-aig-gateway-id. The unified
    // POST /ai/run { model, input } JSON envelope returns result:{} for binary models (Aura-1 TTS).
    const resp = await fetch(workersAiPath(accountId, model), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "cf-aig-gateway-id": cfg.gatewayId,
        "content-type": "application/json",
      },
      body: JSON.stringify(params),
    });
    return parseWorkersAiResponse(resp);
  }

  if (!accountId || !token) {
    throw new Error("Workers AI requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN (or CLOUDFLARE_API_TOKEN)");
  }

  const resp = await fetch(workersAiPath(accountId, model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(params),
  });
  return parseWorkersAiResponse(resp);
}
