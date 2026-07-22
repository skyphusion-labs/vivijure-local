import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gateApi,
  constantTimeEqual,
  isDemoDeniedRead,
  sha256Hex,
  TOKEN_COOKIE,
} from "../src/auth-gate.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { STUDIO_API_TOKEN_PLACEHOLDER } from "../src/studio-token.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

function req(headers: Record<string, string> = {}, method = "GET", path = "/api/cast"): Request {
  return new Request(`https://studio${path}`, { method, headers });
}

function bearer(token: string, path = "/api/cast"): Request {
  return req({ authorization: `Bearer ${token}` }, "GET", path);
}

describe("gateApi -- token mode", () => {
  it("denies when STUDIO_API_TOKEN is unset (fail closed)", async () => {
    const d = await gateApi(req(), { AUTH_MODE: "token" });
    expect(d).toMatchObject({ ok: false, status: 403 });
  });

  it("denies when STUDIO_API_TOKEN is the public compose placeholder", async () => {
    const env = { AUTH_MODE: "token", STUDIO_API_TOKEN: STUDIO_API_TOKEN_PLACEHOLDER };
    const d = await gateApi(bearer(STUDIO_API_TOKEN_PLACEHOLDER), env);
    expect(d).toMatchObject({ ok: false, status: 403 });
    if (!d.ok) expect(d.reason).toContain("public placeholder");
  });

  it("admits a valid bearer token", async () => {
    const env = { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET };
    expect((await gateApi(bearer(SECRET), env)).ok).toBe(true);
  });

  it("denies a bad bearer token", async () => {
    const env = { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET };
    expect(await gateApi(bearer("wrong"), env)).toMatchObject({ ok: false, status: 403 });
  });

  it("honors vivijure_token cookie on GET only", async () => {
    const env = { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET };
    const ok = await gateApi(
      req({ cookie: `${TOKEN_COOKIE}=${encodeURIComponent(SECRET)}` }, "GET"),
      env,
    );
    expect(ok.ok).toBe(true);
    const denied = await gateApi(
      req({ cookie: `${TOKEN_COOKIE}=${encodeURIComponent(SECRET)}` }, "POST"),
      env,
    );
    expect(denied).toMatchObject({ ok: false, status: 403 });
  });

  it("admits named api_tokens from D1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vj-auth-"));
    const dbPath = join(dir, "t.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    const db = openDatabase(dbPath);
    const token = "consumer-secret-token-value";
    const hash = await sha256Hex(token);
    await db.prepare("INSERT INTO api_tokens (name, token_hash) VALUES (?1, ?2)").bind("bot", hash).run();
    const env = { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, DB: db };
    const d = await gateApi(bearer(token), env);
    expect(d).toMatchObject({ ok: true, sub: "api-token:bot" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("legacy unset mode allows ALLOW_UNAUTHENTICATED", async () => {
    expect((await gateApi(req(), { ALLOW_UNAUTHENTICATED: "true" })).ok).toBe(true);
  });
});

describe("constantTimeEqual + sha256Hex", () => {
  it("compares digests in constant time", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
  });

  it("hashes predictably", async () => {
    const h = await sha256Hex("test");
    expect(h).toHaveLength(64);
  });
});

describe("HTTP routes (M1)", () => {
  let dir: string;
  let platform: Platform;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-m1-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    platform = {
      db: openDatabase(dbPath),
      renders: {} as Platform["renders"],
      chatBucket: {} as Platform["chatBucket"],
      presigner: {} as Platform["presigner"],
      secrets: {} as Platform["secrets"],
      modules: { resolve: () => null, listBindings: () => [] },
      vars: {
        AUTH_MODE: "token",
        STUDIO_API_TOKEN: SECRET,
        STORAGE_BACKEND: "filesystem",
      },
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /health is open without auth", async () => {
    const app = createApp(testSettingsHost(platform));
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      service: "vivijure-studio",
      phase: 3,
      storage: "filesystem",
    });
  });

  it("GET /api/whoami requires token in token mode", async () => {
    const app = createApp(testSettingsHost(platform));
    const denied = await app.request("/api/whoami");
    expect(denied.status).toBe(403);
    const ok = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ user: "studio" });
  });

  it("GET /planner serves planner.html", async () => {
    const app = createApp(testSettingsHost(platform));
    const res = await app.request("/planner");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/html/);
  });
});

describe("gateApi -- demo mode operator-config exposure (#43)", () => {
  const demo = { AUTH_MODE: "demo" };

  it("DENIES GET /api/settings/secrets (operator connection config: S3 key id, account/endpoint ids, topology)", async () => {
    const d = await gateApi(req({}, "GET", "/api/settings/secrets"), demo);
    expect(d).toMatchObject({ ok: false, status: 403 });
  });

  it("DENIES GET /api/settings and GET /api/modules/:name/config", async () => {
    expect(await gateApi(req({}, "GET", "/api/settings"), demo)).toMatchObject({ ok: false, status: 403 });
    expect(await gateApi(req({}, "GET", "/api/modules/keyframe/config"), demo)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("still ALLOWS the demo UI reads: /api/modules catalog and ordinary /api reads", async () => {
    expect(await gateApi(req({}, "GET", "/api/modules"), demo)).toMatchObject({ ok: true });
    expect(await gateApi(req({}, "GET", "/api/cast"), demo)).toMatchObject({ ok: true });
    expect(await gateApi(req({}, "GET", "/api/projects"), demo)).toMatchObject({ ok: true });
  });

  it("isDemoDeniedRead: settings + module-config denied, catalog + other reads allowed", () => {
    expect(isDemoDeniedRead("/api/settings/secrets")).toBe(true);
    expect(isDemoDeniedRead("/api/settings")).toBe(true);
    expect(isDemoDeniedRead("/api/modules/musetalk/config")).toBe(true);
    expect(isDemoDeniedRead("/api/modules")).toBe(false);
    expect(isDemoDeniedRead("/api/modules/musetalk")).toBe(false);
    expect(isDemoDeniedRead("/api/cast")).toBe(false);
  });
});
