// HTTP VPC shim: maps VIDEO_FINISH_URL etc. to Workers-style *_VPC fetcher bindings.

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
    const req = typeof input === "string" ? new Request(url, init) : input;
    return fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
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

/** Plain HTTP fetcher for non-VPC callers (module sidecars). */
export { HttpFetcher };
