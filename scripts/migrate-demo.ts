#!/usr/bin/env tsx
/**
 * Apply demo-studio migrations (migrations/demo/*.sql) on top of the base schema.
 *
 *   npm run migrate && npm run migrate:demo
 *
 * Use when AUTH_MODE=demo (public read-only studio + capped render/chat).
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");
const demoDir = join(repoRoot, "migrations", "demo");

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS _demo_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);
const applied = new Set(
  db.prepare("SELECT name FROM _demo_migrations").all().map((r) => (r as { name: string }).name),
);
const files = readdirSync(demoDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(demoDir, file), "utf8");
  db.exec(sql);
  db.prepare("INSERT INTO _demo_migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
  console.log("applied demo migration:", file);
}
db.close();
console.log("demo migrations complete:", dbPath);
