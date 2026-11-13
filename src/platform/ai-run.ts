// Workers AI + gateway run helpers (Node parity with vivijure env.AI.run).

import {
  aiGatewayConfig,
  gatewayLogId,
  type AiGatewayEnv,
} from "./ai-gateway.js";

import { CappedReadError, readCappedBytes } from "../modules/gateway-i2v/shared/provider-media.js";

/** Per-kind cap on a BINARY aiRun response, read before the bytes reach the artifact store (local#580).
 *  The numbers are vivijure-cf's `modules/_shared/provider-media.ts` PROVIDER_AUDIO_MAX_BYTES (32 MB),
 *  PROVIDER_IMAGE_MAX_BYTES (25 MB) and PROVIDER_VIDEO_MAX_BYTES (80 MB, also this repo's
 *  provider-media.ts). Aura-1 TTS output is kilobytes; the cap is a ceiling, not a target. */
export const AIRUN_AUDIO_MAX_BYTES = 32 * 1024 * 1024;
export const AIRUN_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const AIRUN_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

/** Cap for a binary response, chosen by its content type. An unknown binary type takes the image cap
 *  (the smaller of the media caps that is not audio) so nothing is uncapped. */
export function aiRunBinaryCap(contentType: string): number {
  const t = contentType.split(";")[0].trim().toLowerCase();
  if (t.startsWith("audio/")) return AIRUN_AUDIO_MAX_BYTES;
  if (t.startsWith("video/")) return AIRUN_VIDEO_MAX_BYTES;
  return AIRUN_IMAGE_MAX_BYTES;
}

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

/** A non-2xx answer from the Workers AI / AI Gateway API. `status` lets a caller tell a request that
 *  cannot succeed (4xx: routing, validation, auth) from one worth retrying (5xx, 408, 429). local#568. */
export class AiRunHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AiRunHttpError";
  }
}

/** True for a failure a retry can fix: a network error (no status), 5xx, 408 or 429. */
export function aiRunRetryable(e: unknown): boolean {
  if (!(e instanceof AiRunHttpError)) return true;
  return e.status >= 500 || e.status === 408 || e.status === 429;
}

/** A Workers AI model id (`@cf/...`, `@hf/...`). Anything else (`vidu/q3-turbo`, `minimax/music-2.6`,
 *  `google/nano-banana-pro`) is a THIRD-PARTY model. */
export function isWorkersAiModel(model: string): boolean {
  return model.startsWith("@");
}

async function parseWorkersAiResponse(resp: Response, model: string): Promise<unknown> {
  lastGatewayLogId = gatewayLogId(resp);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new AiRunHttpError(resp.status, `workers ai ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const ct = resp.headers.get("content-type") ?? "";
  // TTS / image models return binary (audio/mpeg, audio/wav, image/*). The unified JSON envelope
  // is for text models only; Aura-1 on the path endpoint never wraps bytes in { result }.
  if (!ct.includes("application/json")) {
    // local#580: read through the capped reader. Over the cap is refused here, so nothing is stored.
    const cap = aiRunBinaryCap(ct);
    try {
      const bytes = await readCappedBytes(resp.headers, resp.body, () => resp.arrayBuffer(), cap);
      return bytes.buffer as ArrayBuffer;
    } catch (e) {
      if (e instanceof CappedReadError) {
        throw new CappedReadError(`workers ai binary response from ${model} refused: ${e.message} (cap ${cap} bytes for ${ct || "unknown type"})`);
      }
      throw e;
    }
  }
  const data = (await resp.json()) as { result?: unknown };
  return data.result ?? data;
}

/** Options for one call. `fetch` lets a caller hold a long call (local#568: a gateway video generation
 *  runs minutes, past the default 300 s header timeout of Node's fetch). Defaults to the global fetch. */
export interface AiRunOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Mirrors vivijure aiRun(env, model, params). */
export async function aiRun(env: AiGatewayEnv, model: string, params: unknown, opts: AiRunOptions = {}): Promise<unknown> {
  const doFetch = opts.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
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
    return parseWorkersAiResponse(resp, model);
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
    return parseWorkersAiResponse(resp, model);
  }

  // local#568: a THIRD-PARTY model is reachable only through the universal endpoint, POST /ai/run with
  // the envelope { model, input }. The model-in-path URL answers 400 code 7000 "No route for that URI"
  // for it (measured 2026-11-13 for vidu/q3-turbo and minimax/music-2.6, while the envelope reached
  // validation, code 7003, with a gateway log id). Docs: developers.cloudflare.com/ai-gateway/usage/rest-api/
  // and each model page. cf-aig-gateway-id is accepted on this call (measured: logged with and without it).
  if (!isWorkersAiModel(model)) {
    if (!accountId || !token) {
      throw new Error("Workers AI requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN (or CLOUDFLARE_API_TOKEN)");
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    if (cfg) headers["cf-aig-gateway-id"] = cfg.gatewayId;
    const resp = await doFetch(unifiedRunUrl(accountId), {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: params }),
    });
    return parseWorkersAiResponse(resp, model);
  }

  if (cfg) {
    if (!accountId || !token) {
      throw new Error("Workers AI requires CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN (or CLOUDFLARE_API_TOKEN)");
    }
    // Gateway-routed Workers AI uses the per-model path endpoint + cf-aig-gateway-id. The unified
    // POST /ai/run { model, input } JSON envelope returns result:{} for binary models (Aura-1 TTS).
    const resp = await doFetch(workersAiPath(accountId, model), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "cf-aig-gateway-id": cfg.gatewayId,
        "content-type": "application/json",
      },
      body: JSON.stringify(params),
    });
    return parseWorkersAiResponse(resp, model);
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
  return parseWorkersAiResponse(resp, model);
}
