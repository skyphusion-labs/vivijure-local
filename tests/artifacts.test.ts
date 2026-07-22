import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { parseByteRange } from "../src/shared.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

describe("parseByteRange", () => {
  const SIZE = 1000;

  it("returns null for a missing header", () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
  });

  it("parses bytes=100-199", () => {
    expect(parseByteRange("bytes=100-199", SIZE)).toEqual({
      offset: 100,
      length: 100,
      start: 100,
      end: 199,
    });
  });

  it("returns unsatisfiable when out of bounds", () => {
    expect(parseByteRange("bytes=2000-3000", SIZE)).toBe("unsatisfiable");
  });
});

function makePlatform(artifactRoot: string): Platform {
  const dbPath = join(artifactRoot, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  return {
    db: openDatabase(dbPath),
    renders: new FilesystemObjectStore(artifactRoot),
    chatBucket: new FilesystemObjectStore(artifactRoot),
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SECRET}` };
}

describe("M2 artifacts", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-m2-"));
    app = createApp(testSettingsHost(makePlatform(dir)));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST /api/upload stores image and returns key", async () => {
    const res = await app.request("/api/upload", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; mime: string; bytes: number };
    expect(body.key.startsWith("uploads/")).toBe(true);
    expect(body.mime).toBe("image/png");
    expect(body.bytes).toBe(3);
  });

  it("rejects text/html upload", async () => {
    const res = await app.request("/api/upload", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "text/html" },
      body: "<script>",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/artifact serves bytes with security headers", async () => {
    const store = new FilesystemObjectStore(dir);
    await store.put("renders/abc.png", new Uint8Array([9, 8, 7]), {
      httpMetadata: { contentType: "image/png" },
    });
    const res = await app.request("/api/artifact/renders/abc.png", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("forces a safe content-type for a legacy text/html object", async () => {
    const store = new FilesystemObjectStore(dir);
    await store.put("cast/1/evil.html", new TextEncoder().encode("<script>alert(1)</script>"), {
      httpMetadata: { contentType: "text/html" },
    });
    const res = await app.request("/api/artifact/cast/1/evil.html", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  });

  it("404s keys outside artifact prefixes", async () => {
    const store = new FilesystemObjectStore(dir);
    await store.put("secret/creds.json", new Uint8Array([1]), {
      httpMetadata: { contentType: "application/json" },
    });
    const res = await app.request("/api/artifact/secret/creds.json", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("returns 206 for a satisfiable Range request", async () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const store = new FilesystemObjectStore(dir);
    await store.put("renders/film.mp4", bytes, { httpMetadata: { contentType: "video/mp4" } });
    const res = await app.request("/api/artifact/renders/film.mp4", {
      headers: { ...authHeaders(), Range: "bytes=100-199" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(100);
    expect(Array.from(body)).toEqual(Array.from(bytes.slice(100, 200)));
  });

  it("HEAD returns headers without body", async () => {
    const store = new FilesystemObjectStore(dir);
    await store.put("renders/film.mp4", new Uint8Array(500), {
      httpMetadata: { contentType: "video/mp4" },
    });
    const res = await app.request("/api/artifact/renders/film.mp4", {
      method: "HEAD",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("500");
    expect(await res.text()).toBe("");
  });
});
