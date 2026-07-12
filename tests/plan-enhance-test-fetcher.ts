/**
 * In-process plan.enhance module fetcher for tests (module host without HTTP sidecar).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetcherLike } from "../src/platform/types.js";
import { createChainModuleApp } from "../src/modules/chain/app.js";
import { chainModuleEnvFromProcess } from "../src/modules/chain/chain-env.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "dev/manifests/plan-enhance.json"), "utf8"),
) as Record<string, unknown>;

export function createPlanEnhanceTestFetcher(
  storeDir: string,
  env: Record<string, string | undefined> = {},
): FetcherLike {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const store = new FilesystemObjectStore(storeDir);
  const app = createChainModuleApp(
    manifest,
    "plan-enhance",
    store,
    chainModuleEnvFromProcess(process.env),
  );
  Object.assign(process.env, prev);

  return {
    fetch: async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const path = new URL(url, "http://module").pathname;
      const method =
        init?.method ??
        (typeof input !== "string" && input instanceof Request ? input.method : "GET");
      const body =
        init?.body ??
        (typeof input !== "string" && input instanceof Request ? input.body : undefined);
      const headers =
        init?.headers ??
        (typeof input !== "string" && input instanceof Request ? input.headers : undefined);
      return app.request(path, { method, body, headers });
    },
  };
}
