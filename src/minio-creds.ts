import { randomBytes } from "node:crypto";

/** Compose / .env.example default MinIO root user+password. Unsafe on a public edge. */
export const MINIO_CREDS_PLACEHOLDER = "minioadmin";

export function isMinioCredsPlaceholder(
  access: string | undefined,
  secret: string | undefined,
): boolean {
  const a = (access ?? "").trim();
  const s = (secret ?? "").trim();
  return !a || !s || a === MINIO_CREDS_PLACEHOLDER || s === MINIO_CREDS_PLACEHOLDER;
}

export function mintMinioAccessKey(prefix = "vj"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function mintMinioSecretKey(): string {
  return randomBytes(32).toString("hex");
}
