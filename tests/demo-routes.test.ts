import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "c".repeat(64);
let dir: string;

function applyDemoMigrations(dbPath: string): void {
  const demoDir = join(import.meta.dirname, "..", "migrations", "demo");
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
  for (const file of readdirSync(demoDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(demoDir, file), "utf8"));
    db.prepare("INSERT INTO _demo_migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
  }
  db.close();
}

function demoPlatform(): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-demo-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  applyDemoMigrations(dbPath);
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: { resolve: () => null, listBindings: () => [] },
    vars: {
      AUTH_MODE: "demo",
      PUBLIC_BASE_URL: "http://127.0.0.1:8790",
      PLANNER_AI_MOCK: "true",
    },
  };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("demo routes", () => {
  it("GET /api/demo/menu returns seeded scenes when AUTH_MODE=demo", async () => {
    const app = createApp(testSettingsHost(demoPlatform()));
    const res = await app.request("/api/demo/menu");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenes?: unknown[]; available?: boolean };
    expect(Array.isArray(body.scenes)).toBe(true);
    expect(body.scenes!.length).toBeGreaterThan(0);
    expect(body.available).toBe(false);
  });

  it("POST /api/demo/chat answers with mock assistant", async () => {
    const app = createApp(testSettingsHost(demoPlatform()));
    const res = await app.request("/api/demo/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "what is vivijure?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: string };
    expect(body.reply).toContain("Dev Mock Storyboard");
  });

  it("returns 404 for demo routes when AUTH_MODE=token", async () => {
    const p = demoPlatform();
    p.vars.AUTH_MODE = "token";
    p.vars.STUDIO_API_TOKEN = SECRET;
    const app = createApp(testSettingsHost(p));
    const res = await app.request("/api/demo/menu", {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(404);
  });
});
