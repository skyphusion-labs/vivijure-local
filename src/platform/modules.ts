// HTTP sidecar transport for module workers.
//
// Each MODULE_* binding maps to MODULE_<NAME>_URL (e.g. MODULE_KEYFRAME_URL=http://127.0.0.1:9101).
// The sidecar must expose /module.json, /invoke, /poll, /cancel like a CF Worker module.

import type { FetcherLike, ModuleTransport } from "./types.js";
import { HttpFetcher } from "./http-fetcher.js";

/** Parse MODULE_FOO_URL env vars into binding -> base URL. */
export function moduleUrlsFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MODULE_") || !key.endsWith("_URL") || !value) continue;
    const binding = key.slice(0, -"_URL".length);
    map.set(binding, value.replace(/\/$/, ""));
  }
  return map;
}

export class HttpModuleTransport implements ModuleTransport {
  constructor(private readonly urls: Map<string, string>) {}

  resolve(binding: string): FetcherLike | null {
    const base = this.urls.get(binding);
    if (!base) return null;
    return new HttpFetcher(base);
  }

  listBindings(): string[] {
    return [...this.urls.keys()].sort();
  }
}

export function createModuleTransport(env: NodeJS.ProcessEnv): HttpModuleTransport {
  return new HttpModuleTransport(moduleUrlsFromEnv(env));
}
