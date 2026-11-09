import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { gateApi, sha256Hex } from "../src/auth-gate.js";
import { AUTHZ_DENY_CODE, AUTHZ_DENY_REASON, OPERATOR_ROUTES } from "../src/authz.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import type { Platform } from "../src/platform/types.js";
import { testSettingsHost } from "./test-host.js";

// local#238 (cf#520 twin). THE LOAD-BEARING TEST IS "a consumer-scoped token is refused on an
// operator route". The supporting legs exist because that one can be satisfied by breaking the route
// for EVERYONE: the operator secret and an operator-scoped token must still reach it, and a consumer
// token must still reach a consumer route.

const SECRET = "a".repeat(32) + "b".repeat(32);
const CONSUMER_TOKEN = "c".repeat(64);
const OPERATOR_TOKEN = "e".repeat(64);
const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const SCOPE_MIGRATION = "0023_api_token_scope.sql";

/** Turn a route pattern into a concrete path the router will match. */
const concrete = (pattern: string) => pattern.replace(/:name/g, "image-generate");
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe("local#238 -- per-route token scope", () => {
  let dir: string;
  let db: Platform["db"];
  let platform: Platform;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-238-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, MIGRATIONS);
    db = openDatabase(dbPath);
    await db
      .prepare("INSERT INTO api_tokens (name, token_hash, scope) VALUES (?1, ?2, 'consumer')")
      .bind("reader", await sha256Hex(CONSUMER_TOKEN))
      .run();
    await db
      .prepare("INSERT INTO api_tokens (name, token_hash, scope) VALUES (?1, ?2, 'operator')")
      .bind("ops-bot", await sha256Hex(OPERATOR_TOKEN))
      .run();
    platform = {
      db,
      renders: {} as Platform["renders"],
      chatBucket: {} as Platform["chatBucket"],
      presigner: {} as Platform["presigner"],
      secrets: {} as Platform["secrets"],
      modules: { resolve: () => null, listBindings: () => [] },
      vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, STORAGE_BACKEND: "filesystem" },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a CONSUMER token is refused on EVERY operator route, with scope_denied", async () => {
    const app = createApp(testSettingsHost(platform));
    expect(OPERATOR_ROUTES.length).toBeGreaterThan(0);
    for (const r of OPERATOR_ROUTES) {
      const res = await app.request(concrete(r.pattern), {
        method: r.method,
        headers: { ...auth(CONSUMER_TOKEN), "content-type": "application/json" },
        body: r.method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${r.method} ${r.pattern}`).toBe(403);
      expect(await res.json(), `${r.method} ${r.pattern}`).toEqual({
        error: AUTHZ_DENY_REASON,
        code: AUTHZ_DENY_CODE,
      });
    }
  });

  it("the deny holds for HEAD and for a percent-encoded spelling of the path", async () => {
    const app = createApp(testSettingsHost(platform));
    const head = await app.request("/api/settings/secrets", { method: "HEAD", headers: auth(CONSUMER_TOKEN) });
    expect(head.status).toBe(403);
    const encoded = await app.request("/api/settings/%73ecrets", { headers: auth(CONSUMER_TOKEN) });
    // Whatever the router does with the spelling, it must never serve the secrets surface.
    expect(encoded.status).not.toBe(200);
  });

  it("the operator secret and an OPERATOR-scoped token still reach an operator route", async () => {
    const app = createApp(testSettingsHost(platform));
    for (const t of [SECRET, OPERATOR_TOKEN]) {
      const res = await app.request("/api/settings/secrets", { headers: auth(t) });
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty("fields");
    }
  });

  it("a CONSUMER token still reaches a consumer route", async () => {
    const app = createApp(testSettingsHost(platform));
    const res = await app.request("/api/cast", { headers: auth(CONSUMER_TOKEN) });
    expect(res.status).toBe(200);
  });

  it("the deny reason does not trigger the paste-a-token prompt (read from the shim itself)", () => {
    const shim = readFileSync(join(import.meta.dirname, "..", "public", "auth-token.js"), "utf8");
    const m = /if \(\/(.+?)\/(\w*)\.test\(reason\)\)/.exec(shim);
    expect(m, "shim regex not found").not.toBeNull();
    const re = new RegExp(m![1], m![2]);
    expect(re.test("bad API token")).toBe(true); // positive control: the regex is the live one
    expect(re.test(AUTHZ_DENY_REASON)).toBe(false);
  });

  it("every OPERATOR_ROUTES entry is a route the app actually registers", () => {
    const app = createApp(testSettingsHost(platform));
    const handlers = new Set(
      app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`),
    );
    for (const r of OPERATOR_ROUTES) {
      expect(handlers.has(`${r.method} ${r.pattern}`), `${r.method} ${r.pattern}`).toBe(true);
    }
  });

  it("a row whose scope is outside the union fails CLOSED with the ordinary bad-token reason", async () => {
    const raw = new DatabaseSync(join(dir, "studio.db"));
    raw.exec("PRAGMA ignore_check_constraints = ON");
    raw.prepare("INSERT INTO api_tokens (name, token_hash, scope) VALUES (?, ?, ?)").run(
      "weird",
      await sha256Hex("w".repeat(64)),
      "admin",
    );
    raw.close();
    const d = await gateApi(new Request("https://studio/api/cast", { headers: auth("w".repeat(64)) }), {
      AUTH_MODE: "token",
      STUDIO_API_TOKEN: SECRET,
      DB: db,
    });
    expect(d).toEqual({ ok: false, status: 403, reason: "bad API token" });
  });
});

describe("local#238 -- migration 0023", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-238m-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A migrations dir holding everything BEFORE 0023, i.e. an install that predates this change. */
  function preScopeMigrations(): string {
    const out = join(dir, "pre");
    mkdirSync(out);
    for (const f of readdirSync(MIGRATIONS)) {
      if (/^\d{4}_.*\.sql$/.test(f) && f < SCOPE_MIGRATION) copyFileSync(join(MIGRATIONS, f), join(out, f));
    }
    return out;
  }

  it("an existing named token becomes consumer, and applying twice through the runner is a no-op", async () => {
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, preScopeMigrations());
    const before = new DatabaseSync(dbPath);
    expect(before.prepare("SELECT name FROM pragma_table_info('api_tokens') WHERE name = 'scope'").all()).toEqual([]);
    before.prepare("INSERT INTO api_tokens (name, token_hash) VALUES ('legacy', 'h1')").run();
    before.close();

    migrateDatabase(dbPath, MIGRATIONS);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare("SELECT scope FROM api_tokens WHERE name = 'legacy'").get()).toEqual({ scope: "consumer" });
    // An operator re-scopes it, then the runner runs again (every boot does).
    db.prepare("UPDATE api_tokens SET scope = 'operator' WHERE name = 'legacy'").run();
    db.close();
    migrateDatabase(dbPath, MIGRATIONS);
    const after = new DatabaseSync(dbPath);
    expect(after.prepare("SELECT scope FROM api_tokens WHERE name = 'legacy'").get()).toEqual({ scope: "operator" });
    after.close();
  });

  it("executing the file a second time BY HAND refuses and changes nothing", () => {
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, MIGRATIONS);
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO api_tokens (name, token_hash, scope) VALUES ('ops', 'h2', 'operator')").run();
    const sql = readFileSync(join(MIGRATIONS, SCOPE_MIGRATION), "utf8");
    db.exec("BEGIN");
    expect(() => db.exec(sql)).toThrow(/duplicate column/);
    db.exec("ROLLBACK");
    expect(db.prepare("SELECT scope FROM api_tokens WHERE name = 'ops'").get()).toEqual({ scope: "operator" });
    db.close();
  });

  it("the CHECK refuses a scope outside the union on new writes", () => {
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, MIGRATIONS);
    const db = new DatabaseSync(dbPath);
    expect(() =>
      db.prepare("INSERT INTO api_tokens (name, token_hash, scope) VALUES ('x', 'h3', 'admin')").run(),
    ).toThrow(/CHECK/);
    db.close();
  });
});
