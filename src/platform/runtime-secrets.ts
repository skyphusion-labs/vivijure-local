import type { SecretStore } from "./types.js";
import type { RuntimeEnv } from "./runtime-env.js";

/** SecretStore backed by the merged runtime env (DB overrides + process.env fallback). */
export class RuntimeSecretStore implements SecretStore {
  constructor(private readonly runtime: RuntimeEnv) {}

  async get(name: string): Promise<string | undefined> {
    return this.runtime.get(name);
  }
}
