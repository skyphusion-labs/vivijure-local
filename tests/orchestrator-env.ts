import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";

/** Attach a mock PRESIGNER for orchestration unit tests (mirrors vivijure-cf/tests/orchestrator-env.ts). */
export function orch<T extends object>(env: T): T & OrchestratorEnv {
  return Object.assign(env, {
    PRESIGNER: {
      presignGet: async (key: string) => `https://presign.test/${key}?sig=test`,
      presignPut: async (key: string) => `https://presign.test/put/${key}?sig=test`,
    },
  }) as T & OrchestratorEnv;
}
