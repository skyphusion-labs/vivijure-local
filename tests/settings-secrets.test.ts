import { describe, expect, it, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { RuntimeSecretStore } from "../src/platform/runtime-secrets.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";
import type { Platform } from "../src/platform/types.js";
import { testSettingsHost } from "./test-host.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

function makePlatform(): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-secrets-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  const runtime = RuntimeEnv.forTests({ STUDIO_API_TOKEN: SECRET });
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new RuntimeSecretStore(runtime),
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

function auth(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${SECRET}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
  );
}

let app: ReturnType<typeof createApp>;

describe("settings secrets API", () => {
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/settings/secrets lists catalog fields masked", async () => {
    app = createApp(testSettingsHost(makePlatform()));
    const res = await auth("/api/settings/secrets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: unknown[];
      fields: { key: string; configured?: boolean; display?: string; source?: string }[];
    };
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.fields.some((f: { key: string }) => f.key === "S3_SECRET_ACCESS_KEY")).toBe(true);
    expect(body.fields.some((f: { key: string }) => f.key === "STUDIO_API_TOKEN")).toBe(false);
  });

  it("PATCH /api/settings/secrets persists and masks values", async () => {
    const platform = makePlatform();
    app = createApp(testSettingsHost(platform));
    const patch = await auth("/api/settings/secrets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { GATEWAY_ID: "vivijure-test" } }),
    });
    expect(patch.status).toBe(200);
    const get = await auth("/api/settings/secrets");
    const body = (await get.json()) as {
      fields: { key: string; configured?: boolean; display?: string; source?: string }[];
    };
    const gw = body.fields.find((f) => f.key === "GATEWAY_ID");
    expect(gw).toBeDefined();
    expect(gw!.configured).toBe(true);
    expect(gw!.source).toBe("database");
    expect(gw!.display).toBe("vivijure-test");
  });

  it("PATCH /api/settings/secrets ignores install-only STUDIO_API_TOKEN", async () => {
    const platform = makePlatform();
    app = createApp(testSettingsHost(platform));
    const patch = await auth("/api/settings/secrets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { STUDIO_API_TOKEN: "x".repeat(64) } }),
    });
    expect(patch.status).toBe(200);
    expect(platform.vars.STUDIO_API_TOKEN).toBe(SECRET);
  });
});
