import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gateApi,
  constantTimeEqual,
  sha256Hex,
  TOKEN_COOKIE,
} from "../src/auth-gate.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
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
    const app = createApp(platform);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      service: "vivijure-studio",
      phase: 2,
      storage: "filesystem",
    });
  });

  it("GET /api/whoami requires token in token mode", async () => {
    const app = createApp(platform);
    const denied = await app.request("/api/whoami");
    expect(denied.status).toBe(403);
    const ok = await app.request("/api/whoami", {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ user: "studio" });
  });

  it("GET /planner serves planner.html", async () => {
    const app = createApp(platform);
    const res = await app.request("/planner");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/html/);
  });
});
