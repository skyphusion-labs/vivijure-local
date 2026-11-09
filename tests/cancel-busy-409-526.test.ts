// core#448 (core 1.34.0): cancelFilmJob throws FilmBusyError when it cannot take the film's advance lease
// in time. On 1.26 it never threw, so the bump would turn this into a new 500. The route answers 409 with
// the job id and retryable, the same body vivijure-cf sends (cf src/studio.ts hCancelFilm).
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@skyphusion-labs/vivijure-core/film-orchestrator", async (orig) => {
  const actual = await orig<typeof import("@skyphusion-labs/vivijure-core/film-orchestrator")>();
  return { ...actual, cancelFilmJob: vi.fn(async (_env: unknown, id: string) => { throw new actual.FilmBusyError(id); }) };
});

import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("DELETE /api/storyboard/render/:jobId while the film is busy", () => {
  it("answers 409 with the job id and retryable, never 500", async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-526c-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    const store = new FilesystemObjectStore(join(dir, "renders"));
    const p: Platform = {
      db: openDatabase(dbPath), renders: store, chatBucket: store,
      presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
      secrets: new EnvSecretStore({}), modules: { resolve: () => null, listBindings: () => [] },
      vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
    };
    const app = createApp(testSettingsHost(p));
    const r = await app.request("/api/storyboard/render/film-busy1", { method: "DELETE", headers: { authorization: `Bearer ${SECRET}` } });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: string; jobId: string; retryable: boolean };
    expect(body).toMatchObject({ jobId: "film-busy1", retryable: true });
    expect(body.error).toContain("busy");
  });
});
