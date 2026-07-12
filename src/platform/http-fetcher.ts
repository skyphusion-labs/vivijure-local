// Shared HTTP fetcher (module sidecars + CPU VPC shims).

export class HttpFetcher {
  constructor(private readonly baseUrl: string) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const url = new URL(req.url, this.baseUrl);
    return fetch(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
  }
}
