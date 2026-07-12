// Merged operator environment: install/bootstrap + GUI-persisted platform_secrets (DB wins).

import type { Database } from "./types.js";
import { listPlatformSecrets } from "../platform-secrets-db.js";

export type EnvSource = "env" | "database";

export class RuntimeEnv {
  private readonly merged: Record<string, string | undefined>;
  private readonly dbKeys = new Set<string>();

  private constructor(base: NodeJS.ProcessEnv, db: Map<string, string>) {
    this.merged = { ...base };
    for (const [key, value] of db) {
      this.merged[key] = value;
      this.dbKeys.add(key);
    }
  }

  static async load(base: NodeJS.ProcessEnv, database: Database): Promise<RuntimeEnv> {
    const db = await listPlatformSecrets(database);
    return new RuntimeEnv(base, db);
  }

  /** In-memory runtime env for tests (no platform_secrets table reads). */
  static forTests(values: Record<string, string | undefined> = {}): RuntimeEnv {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) map.set(key, value);
    }
    return new RuntimeEnv(process.env, map);
  }

  asProcessEnv(): NodeJS.ProcessEnv {
    return this.merged as NodeJS.ProcessEnv;
  }

  get(key: string): string | undefined {
    const v = this.merged[key];
    return v === "" ? undefined : v;
  }

  source(key: string): EnvSource | "unset" {
    if (this.dbKeys.has(key)) return "database";
    const v = this.merged[key];
    if (v !== undefined && v !== "") return "env";
    return "unset";
  }

  async set(database: Database, key: string, value: string): Promise<void> {
    const { upsertPlatformSecret } = await import("../platform-secrets-db.js");
    await upsertPlatformSecret(database, key, value);
    this.merged[key] = value;
    this.dbKeys.add(key);
  }

  async clear(database: Database, key: string): Promise<void> {
    const { deletePlatformSecret } = await import("../platform-secrets-db.js");
    await deletePlatformSecret(database, key);
    this.dbKeys.delete(key);
    const base = process.env[key];
    this.merged[key] = base;
  }
}
