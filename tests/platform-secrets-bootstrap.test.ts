import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapPlatformSecretsFromEnv,
  isStudioApiTokenPlaceholder,
  STUDIO_API_TOKEN_PLACEHOLDER,
} from "../src/platform-secrets-bootstrap.js";
import { listPlatformSecrets, upsertPlatformSecret } from "../src/platform-secrets-db.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

let dir: string;

function openTestDb() {
  dir = mkdtempSync(join(tmpdir(), "vj-bootstrap-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  return openDatabase(dbPath);
}

describe("platform secrets bootstrap", () => {
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("detects placeholder studio tokens", () => {
    expect(isStudioApiTokenPlaceholder("")).toBe(true);
    expect(isStudioApiTokenPlaceholder(STUDIO_API_TOKEN_PLACEHOLDER)).toBe(true);
    expect(isStudioApiTokenPlaceholder("a".repeat(64))).toBe(false);
  });

  it("seeds missing bootstrap keys from env without overwriting DB", async () => {
    const db = openTestDb();
    await upsertPlatformSecret(db, "GATEWAY_ID", "existing");

    const result = await bootstrapPlatformSecretsFromEnv(db, {
      STUDIO_API_TOKEN: "b".repeat(64),
      GATEWAY_ID: "from-env",
      S3_ENDPOINT: "http://minio:9000",
      S3_ACCESS_KEY_ID: "minioadmin",
    });

    expect(result.seeded).toContain("STUDIO_API_TOKEN");
    expect(result.seeded).toContain("S3_ENDPOINT");
    expect(result.seeded).not.toContain("GATEWAY_ID");

    const stored = await listPlatformSecrets(db);
    expect(stored.get("STUDIO_API_TOKEN")).toBe("b".repeat(64));
    expect(stored.get("GATEWAY_ID")).toBe("existing");
    expect(stored.get("S3_ENDPOINT")).toBe("http://minio:9000");
  });

  it("skips placeholder STUDIO_API_TOKEN", async () => {
    const db = openTestDb();
    const result = await bootstrapPlatformSecretsFromEnv(db, {
      STUDIO_API_TOKEN: STUDIO_API_TOKEN_PLACEHOLDER,
      S3_BUCKET: "vivijure",
    });

    expect(result.seeded).not.toContain("STUDIO_API_TOKEN");
    expect(result.seeded).toContain("S3_BUCKET");
    const stored = await listPlatformSecrets(db);
    expect(stored.has("STUDIO_API_TOKEN")).toBe(false);
  });
});
