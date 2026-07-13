// SQLite database adapter (D1-compatible API surface for ported helpers).
// Uses Node built-in node:sqlite (Node 22.5+) to avoid native addon compile pain.

import { readdirSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Database as DatabaseIface, PreparedStatement } from "./types.js";

type SqlValue = string | number | bigint | null | Uint8Array;

function sqlArgs(values: unknown[]): SqlValue[] {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "bigint" || typeof v === "number" || typeof v === "string" || v === null) {
      return v;
    }
    if (v instanceof Uint8Array) return v;
    return String(v);
  });
}

class SqliteStatement implements PreparedStatement {
  private binds: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): PreparedStatement {
    this.binds = values;
    return this;
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...sqlArgs(this.binds)) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return row[column] as T;
    return row as T;
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number } }> {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...sqlArgs(this.binds));
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...sqlArgs(this.binds)) as T[];
    return { results };
  }
}

class SqliteDatabase implements DatabaseIface {
  constructor(private readonly db: DatabaseSync) {}

  prepare(query: string): PreparedStatement {
    return new SqliteStatement(this.db, query);
  }

  async batch(statements: PreparedStatement[]): Promise<unknown[]> {
    this.db.exec("BEGIN");
    try {
      const out: unknown[] = [];
      for (const stmt of statements) {
        out.push(await stmt.run());
      }
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function openDatabase(path: string): DatabaseIface {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // #49: the studio process and every module sidecar open independent connections to the same DB.
  // WAL allows one writer; without a busy_timeout a second concurrent writer (a sidecar boot migration
  // racing an operator "Save settings" upsert) gets an IMMEDIATE SQLITE_BUSY throw. Wait up to 5s for
  // the lock instead so cross-process writes serialize rather than fail.
  db.exec("PRAGMA busy_timeout = 5000");
  return new SqliteDatabase(db);
}

/** Apply numbered SQL migrations from migrations/ (skips demo/ and manual/). */
export function migrateDatabase(dbPath: string, migrationsDir: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000"); // #49: don't throw SQLITE_BUSY if a sibling connection holds the write lock
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r) => (r as { name: string }).name),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    // #49: apply each migration file ATOMICALLY. Without the transaction, SQLite auto-commits each
    // statement and the _migrations row is written only after the whole file -- so a mid-file failure
    // (constraint / SQLITE_BUSY / disk) leaves statements 1..N-1 committed but the file UNRECORDED, and
    // the next boot re-runs from statement 1 -> "table already exists" -> boot wedged until DB surgery.
    // BEGIN/COMMIT makes the file + its _migrations row all-or-nothing; a throw rolls back cleanly so the
    // next boot re-runs the file from a clean slate.
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  }
  db.close();
}
