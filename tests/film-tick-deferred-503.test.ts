import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// local#503. vivijure-core#428 makes advanceFilmJob THROW when storage blocks the film's doc, and
// leave the film in progress for the next tick. Both poll routes here call it. Each must answer the
// contract's uncaught-error envelope (`500 {"error":"internal error"}`, cf docs/CONTRACT.md), log the
// deferral, and write NOTHING about the render this tick: no insertRender, no updateRenderFromView.
//
// The throw is injected. The pinned core (1.26.0) does not carry core#428, so no real storage fault
// can reach this branch yet. What this file proves is the HOST half: given the throw core#428
// documents, neither route lets it escape and neither touches the render row.

const advance = vi.fn();
const insertRender = vi.fn();
const updateRenderFromView = vi.fn();

vi.mock("@skyphusion-labs/vivijure-core/film-orchestrator", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, advanceFilmJob: (...a: unknown[]) => advance(...a) };
});
vi.mock("@skyphusion-labs/vivijure-core/renders-db", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    insertRender: (...a: unknown[]) => insertRender(...a),
    updateRenderFromView: (...a: unknown[]) => updateRenderFromView(...a),
  };
});

const { createApp } = await import("../src/app.js");
const { openDatabase, migrateDatabase } = await import("../src/platform/sqlite.js");
const { testSettingsHost } = await import("./test-host.js");
type Platform = import("../src/platform/types.js").Platform;

const SECRET = "a".repeat(32) + "b".repeat(32);
const FILM = "film-503deferred";
const ROUTES = [`/api/render/film/${FILM}`, `/api/storyboard/render/${FILM}`];

describe("local#503 -- a film tick that throws is left for the next tick", () => {
  let dir: string;
  let platform: Platform;
  let warn: { mock: { calls: unknown[][] } };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-503-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    platform = {
      db: openDatabase(dbPath),
      renders: {} as Platform["renders"],
      chatBucket: {} as Platform["chatBucket"],
      presigner: {} as Platform["presigner"],
      secrets: {} as Platform["secrets"],
      modules: { resolve: () => null, listBindings: () => [] },
      vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, STORAGE_BACKEND: "filesystem" },
    };
    advance.mockReset();
    insertRender.mockReset();
    updateRenderFromView.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  for (const path of ROUTES) {
    it(`${path.replace(FILM, ":id")}: answers the contract envelope, logs, and writes no render row`, async () => {
      advance.mockRejectedValue(new Error("R2 get failed: storage unavailable"));
      const app = createApp(testSettingsHost(platform));
      const res = await app.request(path, { headers: { authorization: `Bearer ${SECRET}` } });

      expect(advance).toHaveBeenCalledTimes(1);
      expect(advance.mock.calls[0][1]).toBe(FILM);
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/json/);
      // The storage reason stays in the log; the wire carries the contract's bytes and nothing else.
      expect(await res.json()).toEqual({ error: "internal error" });
      expect(insertRender).not.toHaveBeenCalled();
      expect(updateRenderFromView).not.toHaveBeenCalled();

      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("film.poll_deferred"));
      expect(lines).toHaveLength(1);
      const ev = JSON.parse(lines[0]);
      expect(ev).toMatchObject({ ev: "film.poll_deferred", film_id: FILM, error: "R2 get failed: storage unavailable" });
      // The route template, never the raw path (cf#223).
      expect(ev.route).not.toContain(FILM);
    });
  }

  it("a film that is gone is still a 404, not a deferral", async () => {
    advance.mockResolvedValue(null);
    const app = createApp(testSettingsHost(platform));
    for (const path of ROUTES) {
      const res = await app.request(path, { headers: { authorization: `Bearer ${SECRET}` } });
      expect(res.status, path).toBe(404);
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes("film.poll_deferred"))).toBe(false);
  });
});
