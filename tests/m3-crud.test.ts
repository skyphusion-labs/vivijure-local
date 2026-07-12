import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import type { Platform } from "../src/platform/types.js";
import { mergeUserPrefs, normalizeUserPrefs, DEFAULT_USER_PREFS } from "../src/user-prefs.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

function auth() {
  return { authorization: `Bearer ${SECRET}` };
}

function makePlatform(root: string): Platform {
  const dbPath = join(root, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(root);
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

describe("user-prefs pure helpers", () => {
  it("normalizes defaults", () => {
    expect(normalizeUserPrefs(undefined)).toEqual(DEFAULT_USER_PREFS);
    expect(mergeUserPrefs({ emailNotifications: false }, { emailNotifications: true })).toEqual({
      emailNotifications: true,
    });
  });
});

describe("M3 CRUD routes", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-m3-"));
    app = createApp(makePlatform(dir));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("projects: create, list, get, patch storyboard, delete", async () => {
    const create = await app.request("/api/storyboard/projects", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "My Film", prefs: { tier: "draft" } }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { project: { id: string; name: string } };
    expect(created.project.name).toBe("My Film");

    const list = await app.request("/api/storyboard/projects", { headers: auth() });
    const listed = (await list.json()) as { projects: { id: string }[] };
    expect(listed.projects).toHaveLength(1);

    const get = await app.request(`/api/storyboard/projects/${created.project.id}`, { headers: auth() });
    expect(get.status).toBe(200);

    const patch = await app.request(`/api/storyboard/projects/${created.project.id}`, {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ storyboard: { scenes: [] } }),
    });
    expect(patch.status).toBe(200);

    const del = await app.request(`/api/storyboard/projects/${created.project.id}`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("rejects integer project id (enumeration guard)", async () => {
    const res = await app.request("/api/storyboard/projects/5", { headers: auth() });
    expect(res.status).toBe(404);
  });

  it("cast: create, patch voice, portrait upload, delete reclaims artifact", async () => {
    const create = await app.request("/api/cast", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "Hero", bible: "A pilot" }),
    });
    expect(create.status).toBe(201);
    const { cast } = (await create.json()) as { cast: { id: string } };

    const patch = await app.request(`/api/cast/${cast.id}`, {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ voice_id: "angus" }),
    });
    expect(patch.status).toBe(200);

    const portrait = await app.request(`/api/cast/${cast.id}/portrait`, {
      method: "POST",
      headers: { ...auth(), "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(portrait.status).toBe(200);
    const withPortrait = (await portrait.json()) as { cast: { portrait_key: string } };
    expect(withPortrait.cast.portrait_key).toMatch(/^cast\//);

    const del = await app.request(`/api/cast/${cast.id}`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(200);
    const store = new FilesystemObjectStore(dir);
    expect(await store.head(withPortrait.cast.portrait_key)).toBeNull();
  });

  it("prefs: defaults then patch persists", async () => {
    const get0 = await app.request("/api/prefs", { headers: auth() });
    expect(await get0.json()).toEqual({ ok: true, prefs: { emailNotifications: false } });

    const patch = await app.request("/api/prefs", {
      method: "PATCH",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ emailNotifications: true }),
    });
    expect(patch.status).toBe(200);

    const get1 = await app.request("/api/prefs", { headers: auth() });
    expect(await get1.json()).toEqual({ ok: true, prefs: { emailNotifications: true } });
  });
});
