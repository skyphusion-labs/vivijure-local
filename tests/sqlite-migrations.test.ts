import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import type { Database } from "../src/platform/types.js";

// #49: SQLite adapter robustness -- migrations must be atomic (a mid-file failure rolls back cleanly so
// the next boot re-runs the file instead of wedging on "table already exists"), and a connection must set
// busy_timeout so a cross-process writer waits for the lock instead of throwing SQLITE_BUSY immediately.

async function tableNames(db: Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>();
  return new Set(results.map((r) => r.name));
}
async function appliedMigrations(db: Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT name FROM _migrations").all<{ name: string }>();
  return new Set(results.map((r) => r.name));
}

describe("sqlite migrations are atomic (#49)", () => {
  let dir = "";
  let dbPath = "";
  let migDir = "";

  beforeEach(() => {
    dir = join(tmpdir(), `vj-migtest-${process.pid}-${Math.floor(performance.now() * 1000)}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "studio.db");
    migDir = join(dir, "migrations");
    mkdirSync(migDir, { recursive: true });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const migration = (name: string, sql: string) => writeFileSync(join(migDir, name), sql);

  it("rolls the WHOLE file back when a later statement fails -- no partial state, file NOT recorded", async () => {
    migration("0001_ok.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    // 0002: a valid CREATE followed by a statement that MUST fail (unknown table). Without the per-file
    // transaction, table `b` commits and 0002 is left unrecorded -> next boot re-runs -> "table b already
    // exists" -> wedged. The fix rolls the whole file back.
    migration("0002_bad.sql", "CREATE TABLE b (id INTEGER);\nINSERT INTO does_not_exist VALUES (1);");

    expect(() => migrateDatabase(dbPath, migDir)).toThrow();

    const db = openDatabase(dbPath);
    const applied = await appliedMigrations(db);
    const tables = await tableNames(db);

    expect(applied.has("0001_ok.sql")).toBe(true); // first file committed
    expect(applied.has("0002_bad.sql")).toBe(false); // failed file NOT recorded
    expect(tables.has("a")).toBe(true); // 0001's table survives
    expect(tables.has("b")).toBe(false); // 0002's first statement rolled back with the failing one
  });

  it("re-running after a fixed migration applies cleanly (no leftover-partial wedge)", async () => {
    migration("0001_ok.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    migration("0002_bad.sql", "CREATE TABLE b (id INTEGER);\nINSERT INTO does_not_exist VALUES (1);");
    expect(() => migrateDatabase(dbPath, migDir)).toThrow();

    // operator fixes 0002; the next boot must apply it with no "table b already exists" from a partial run
    migration("0002_bad.sql", "CREATE TABLE b (id INTEGER);");
    expect(() => migrateDatabase(dbPath, migDir)).not.toThrow();

    const db = openDatabase(dbPath);
    expect((await appliedMigrations(db)).has("0002_bad.sql")).toBe(true);
    expect((await tableNames(db)).has("b")).toBe(true);
  });

  it("openDatabase sets a non-zero busy_timeout so a cross-process writer waits, not throws", async () => {
    migration("0001_ok.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    migrateDatabase(dbPath, migDir);
    const db = openDatabase(dbPath);
    const timeout = await db.prepare("PRAGMA busy_timeout").first<number>("timeout");
    expect(timeout).toBe(5000);
  });
});
