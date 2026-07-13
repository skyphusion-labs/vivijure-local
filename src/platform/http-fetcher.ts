// Shared HTTP fetcher (module sidecars + CPU VPC shims).

type FetchInitWithDuplex = RequestInit & { duplex?: "half" };

function withDuplex(init: RequestInit | undefined, hasBody: boolean): FetchInitWithDuplex | undefined {
  if (!hasBody || !init) return init;
  return { ...init, duplex: "half" };
}

export class HttpFetcher {
  constructor(private readonly baseUrl: string) {}

  /** Workers module bindings use logical https://module/... URLs; rewrite to the sidecar base. */
  private resolveUrl(inputUrl: string): string {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const parsed = new URL(inputUrl, base);
    if (parsed.hostname === "module") {
      return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, base).toString();
    }
    return parsed.toString();
  }

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    if (typeof input === "string") {
      const url = this.resolveUrl(input);
      const hasBody = init?.body != null && init.method !== "GET" && init.method !== "HEAD";
      return fetch(url, withDuplex(init, !!hasBody) ?? init);
    }
    const url = this.resolveUrl(input.url);
    const hasBody = input.body != null && input.method !== "GET" && input.method !== "HEAD";
    return fetch(
      url,
      withDuplex(
        {
          method: input.method,
          headers: input.headers,
          body: input.body,
          // #55: forward the caller's AbortSignal (+ redirect/credentials) so a hung sidecar call is actually
          // cancellable; the old rebuild dropped them, so an abort never propagated to the outbound fetch.
          signal: input.signal,
          redirect: input.redirect,
          credentials: input.credentials,
        },
        hasBody,
      )!,
    );
  }
}
