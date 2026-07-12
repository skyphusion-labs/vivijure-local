import type { Database } from "./platform/types.js";

export async function listPlatformSecrets(db: Database): Promise<Map<string, string>> {
  const rs = await db.prepare("SELECT secret_key, value_text FROM platform_secrets").all<{
    secret_key: string;
    value_text: string;
  }>();
  const out = new Map<string, string>();
  for (const row of rs.results ?? []) {
    out.set(row.secret_key, row.value_text);
  }
  return out;
}

export async function upsertPlatformSecret(db: Database, key: string, value: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO platform_secrets (secret_key, value_text, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(secret_key) DO UPDATE SET
         value_text = excluded.value_text,
         updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}

export async function deletePlatformSecret(db: Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM platform_secrets WHERE secret_key = ?").bind(key).run();
}
