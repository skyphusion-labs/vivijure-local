import type { FetcherLike } from "./types.js";
import { HttpFetcher } from "./http-fetcher.js";

/** Env URL key -> orchestrator binding name (vivijure Env parity). */
export const VPC_URL_BINDINGS: ReadonlyArray<{
  binding: string;
  urlKey: string;
  logicalHost: string;
}> = [
  { binding: "VIDEO_FINISH_VPC", urlKey: "VIDEO_FINISH_URL", logicalHost: "video-finish" },
  { binding: "IMAGE_PREP_VPC", urlKey: "IMAGE_PREP_URL", logicalHost: "image-prep" },
  { binding: "AUDIO_BEAT_SYNC_VPC", urlKey: "AUDIO_BEAT_SYNC_URL", logicalHost: "audio-beat-sync" },
  { binding: "AUDIO_MIX_VPC", urlKey: "AUDIO_MIX_URL", logicalHost: "audio-mix" },
  { binding: "AUDIO_MASTER_VPC", urlKey: "AUDIO_MASTER_URL", logicalHost: "audio-master" },
];

/** Rewrites Workers VPC logical hostnames (http://video-finish/...) to the real compose/base URL. */
export class VpcHttpFetcher {
  constructor(
    private readonly baseUrl: string,
    private readonly logicalHost: string,
  ) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === "string" && !input.startsWith("http")
        ? this.resolveUrl(input)
        : this.resolveUrl(typeof input === "string" ? input : input.url);
    if (typeof input === "string") {
      const hasBody = init?.body != null && init.method !== "GET" && init.method !== "HEAD";
      const options = hasBody ? { ...init, duplex: "half" as const } : init;
      return fetch(url, options);
    }
    const hasBody = input.body != null && input.method !== "GET" && input.method !== "HEAD";
    return fetch(url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      // #55: forward AbortSignal (+ redirect/credentials) so a caller can actually cancel a VPC call.
      signal: input.signal,
      redirect: input.redirect,
      credentials: input.credentials,
      ...(hasBody ? { duplex: "half" as const } : {}),
    });
  }

  private resolveUrl(inputUrl: string): string {
    const parsed = new URL(inputUrl, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (parsed.hostname === this.logicalHost) {
      const base = new URL(this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
      return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, base).toString();
    }
    return parsed.toString();
  }
}

export function vpcUrlsFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const map = new Map<string, string>();
  for (const { binding, urlKey } of VPC_URL_BINDINGS) {
    const value = env[urlKey]?.trim();
    if (value) map.set(binding, value.replace(/\/$/, ""));
  }
  return map;
}

/** Inject FetcherLike VPC bindings into an orchestrator env bag. */
export function injectVpcFetchers(env: Record<string, unknown>, processEnv: NodeJS.ProcessEnv): void {
  for (const { binding, urlKey, logicalHost } of VPC_URL_BINDINGS) {
    const base = processEnv[urlKey]?.trim()?.replace(/\/$/, "");
    if (base) env[binding] = new VpcHttpFetcher(base, logicalHost);
  }
}

/** Build Platform.hostBindings from merged runtime env (Node homelab VPC shim). */
export function buildVpcHostBindings(processEnv: NodeJS.ProcessEnv): Record<string, FetcherLike> {
  const bindings: Record<string, unknown> = {};
  injectVpcFetchers(bindings, processEnv);
  return bindings as Record<string, FetcherLike>;
}

export { HttpFetcher };
