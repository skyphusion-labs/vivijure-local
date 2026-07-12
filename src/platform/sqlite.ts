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
}

export function openDatabase(path: string): DatabaseIface {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return new SqliteDatabase(db);
}

/** Apply numbered SQL migrations from migrations/ (skips demo/ and manual/). */
export function migrateDatabase(dbPath: string, migrationsDir: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
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
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
  }
  db.close();
}
