// Secret resolution from process.env (.env via dotenv at boot).

import type { SecretStore } from "./types.js";

export class EnvSecretStore implements SecretStore {
  constructor(private readonly source: NodeJS.ProcessEnv) {}

  async get(name: string): Promise<string | undefined> {
    const v = this.source[name];
    return v === "" ? undefined : v;
  }
}

/** Read a secret or plain var; mirrors vivijure secretValue() for string vars. */
export async function secretValue(
  store: SecretStore,
  name: string,
  fallback?: string,
): Promise<string | undefined> {
  const v = await store.get(name);
  if (v !== undefined) return v;
  return fallback;
}
