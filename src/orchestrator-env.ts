// Orchestrator env bag: D1-shaped DB + R2-shaped object store + module bindings.
// Ported vivijure orchestration imports this instead of the full Cloudflare Env.

import type { Database, ObjectPresigner } from "./platform/types.js";
import type { R2Bucket } from "./platform/r2-adapter.js";

/** Minimal ExecutionContext shim (poll bookkeeping uses waitUntil best-effort). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export const noopExecutionContext: ExecutionContext = {
  waitUntil(promise) {
    void promise.catch((e) => console.warn("waitUntil failed:", e));
  },
};

export interface OrchestratorEnv {
  DB: Database;
  R2_RENDERS: R2Bucket;
  R2: R2Bucket;
  PRESIGNER: ObjectPresigner;
  /** Plain config vars (FILM_CLIP_DURATION_FLOOR, etc.). */
  [key: string]: unknown;
}

/** Alias for upstream `import type { Env } from "./env"` at port sites. */
export type Env = OrchestratorEnv;
