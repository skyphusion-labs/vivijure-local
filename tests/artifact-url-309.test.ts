import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { S3ObjectPresigner } from "../src/platform/s3-store.js";
import {
  ARTIFACT_URL_DEFAULT_TTL,
  ARTIFACT_URL_MAX_TTL,
  ARTIFACT_URL_MIN_TTL,
  clampArtifactUrlTtl,
} from "../src/artifacts.js";
import type { ObjectPresigner, Platform } from "../src/platform/types.js";

// local#309 (cf#317 twin): GET /api/artifact-url/<key> -- turn an artifact KEY into a fetchable URL so
// list_renders' output_key / keyframes[].key stop being dead ends on the self-host door.
//
// The trap this port has to avoid: vivijure-local has TWO presigner backends and, before this fix,
// they disagreed on both guarantees a presigned URL rests on -- SCOPE (one key, never a prefix) and
// EXPIRY (a caller cannot widen the lifetime). The MinIO/S3 backend was always fine; the filesystem
// backend silently dropped the TTL and embedded the full studio bearer token. This suite covers both
// backends plus a positive control proving the token/TTL assertions below are not vacuous.

const SECRET = "a".repeat(32) + "b".repeat(32);
const FILM = "renders/film-abc/film.mp4";

const S3_CFG = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "s3cr3t-test-value-not-a-real-key",
  endpoint: "http://127.0.0.1:9000",
  bucket: "vivijure",
  region: "us-east-1",
};

function makePlatform(artifactRoot: string, presigner: ObjectPresigner): Platform {
  const dbPath = join(artifactRoot, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  return {
    db: openDatabase(dbPath),
    renders: new FilesystemObjectStore(artifactRoot),
    chatBucket: new FilesystemObjectStore(artifactRoot),
    presigner,
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SECRET}` };
}

describe("local#309 clampArtifactUrlTtl", () => {
  it("defaults when the param is absent or blank", () => {
    expect(clampArtifactUrlTtl(null)).toBe(ARTIFACT_URL_DEFAULT_TTL);
    expect(clampArtifactUrlTtl("")).toBe(ARTIFACT_URL_DEFAULT_TTL);
    expect(clampArtifactUrlTtl("   ")).toBe(ARTIFACT_URL_DEFAULT_TTL);
  });

  it("defaults on garbage rather than throwing", () => {
    expect(clampArtifactUrlTtl("abc")).toBe(ARTIFACT_URL_DEFAULT_TTL);
    expect(clampArtifactUrlTtl("NaN")).toBe(ARTIFACT_URL_DEFAULT_TTL);
  });

  it("honours a value inside the band", () => {
    expect(clampArtifactUrlTtl("60")).toBe(60);
    expect(clampArtifactUrlTtl("900")).toBe(900);
    expect(clampArtifactUrlTtl("3600")).toBe(3600);
  });

  // The point of the clamp: a caller asking for a week gets an hour. If this ever returns the
  // caller's number the whole expiry-based security story is gone, so it is asserted directly.
  it("clamps above the ceiling and below the floor", () => {
    expect(clampArtifactUrlTtl("604800")).toBe(ARTIFACT_URL_MAX_TTL);
    expect(clampArtifactUrlTtl("99999999")).toBe(ARTIFACT_URL_MAX_TTL);
    expect(clampArtifactUrlTtl("1")).toBe(ARTIFACT_URL_MIN_TTL);
    expect(clampArtifactUrlTtl("0")).toBe(ARTIFACT_URL_MIN_TTL);
    expect(clampArtifactUrlTtl("-5")).toBe(ARTIFACT_URL_MIN_TTL);
  });
});

describe("local#309 GET /api/artifact-url/<key> -- S3/MinIO backend", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-artifact-url-s3-"));
    app = createApp(testSettingsHost(makePlatform(dir, new S3ObjectPresigner(S3_CFG))));
    const store = new FilesystemObjectStore(dir);
    await store.put(FILM, new Uint8Array(3811331), { httpMetadata: { contentType: "video/mp4" } });
    await store.put("cast/portrait-1.png", new Uint8Array(2048), {
      httpMetadata: { contentType: "image/png" },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a presigned URL plus the object's REAL content-type and size", async () => {
    const res = await app.request(`/api/artifact-url/${FILM}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.key).toBe(FILM);
    expect(body.content_type).toBe("video/mp4");
    expect(body.size).toBe(3811331);
    expect(body.expires_in).toBe(ARTIFACT_URL_DEFAULT_TTL);
    expect(String(body.url)).toContain("127.0.0.1:9000");
    expect(String(body.url)).toContain("X-Amz-Signature=");
  });

  // SCOPE: the signature must cover the one key asked for. A presign that signed a prefix, or the
  // wrong object, would still look like a working URL here -- so assert the key is IN the path and
  // that a DIFFERENT object's key is not.
  it("signs exactly the requested key and no other", async () => {
    const res = await app.request(`/api/artifact-url/${FILM}`, { headers: authHeaders() });
    const body = (await res.json()) as { url: string };
    const signed = new URL(body.url);
    expect(signed.pathname).toBe(`/vivijure/${FILM}`);
    expect(signed.pathname).not.toContain("portrait-1.png");
    expect(signed.pathname).not.toContain("*");
  });

  it("carries the clamped lifetime into the signature, not the caller's number", async () => {
    const res = await app.request(`/api/artifact-url/${FILM}?expires_in=604800`, {
      headers: authHeaders(),
    });
    const body = (await res.json()) as { url: string; expires_in: number };
    expect(body.expires_in).toBe(ARTIFACT_URL_MAX_TTL);
    expect(new URL(body.url).searchParams.get("X-Amz-Expires")).toBe(String(ARTIFACT_URL_MAX_TTL));
  });

  it("serves an image artifact the same way (not film-only)", async () => {
    const res = await app.request("/api/artifact-url/cast/portrait-1.png", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.content_type).toBe("image/png");
    expect(body.size).toBe(2048);
  });

  // --- negative controls: each must FAIL, each a distinct refusal path ----------------------------

  it("404s a key that does not exist in the store (no signed URL for a missing object)", async () => {
    const res = await app.request("/api/artifact-url/renders/nope/absent.mp4", { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("X-Amz-Signature");
  });

  it("404s a key outside the known artifact namespaces", async () => {
    // Seeded so the ONLY thing that can refuse it is the prefix guard, not the existence check.
    const store = new FilesystemObjectStore(dir);
    await store.put("secrets/env.json", new Uint8Array([1]), {
      httpMetadata: { contentType: "application/json" },
    });
    const res = await app.request("/api/artifact-url/secrets/env.json", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("404s a traversal key", async () => {
    const res = await app.request("/api/artifact-url/renders/../secrets/env.json", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  // CONTROL ON THE CONTROLS: the refusals above must not be passing because the route is broken for
  // everything. A known-good key through the SAME harness has to come back 200 with a signature.
  it("positive control: the same harness does produce a signed URL for a valid key", async () => {
    const res = await app.request(`/api/artifact-url/${FILM}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect((await res.json() as { url: string }).url).toContain("X-Amz-Signature=");
  });
});

describe("local#309 GET /api/artifact-url/<key> -- filesystem backend refuses honestly", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-artifact-url-fs-"));
    app = createApp(testSettingsHost(makePlatform(dir, new LocalObjectPresigner("http://127.0.0.1:8790", SECRET))));
    const store = new FilesystemObjectStore(dir);
    await store.put(FILM, new Uint8Array(1024), { httpMetadata: { contentType: "video/mp4" } });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses with 503 rather than a token-bearing, non-expiring URL", async () => {
    const res = await app.request(`/api/artifact-url/${FILM}`, { headers: authHeaders() });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain(SECRET);
    expect(body.error.toLowerCase()).toMatch(/minio|s3/);
  });

  it("still 404s a missing key before ever asking the presigner (existence check first)", async () => {
    const res = await app.request("/api/artifact-url/renders/nope.mp4", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("still 404s a key outside the known namespaces", async () => {
    const res = await app.request("/api/artifact-url/renders/../secrets/env.json", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("local#309 LocalObjectPresigner.presignGet refuses rather than pretending", () => {
  it("throws for any requested TTL instead of returning a URL", async () => {
    const p = new LocalObjectPresigner("http://127.0.0.1:8790", SECRET);
    await expect(p.presignGet(FILM, 60)).rejects.toThrow();
    await expect(p.presignGet(FILM, 3600)).rejects.toThrow();
    await expect(p.presignGet(FILM)).rejects.toThrow();
  });

  it("the refusal message is actionable and never carries the token", async () => {
    const p = new LocalObjectPresigner("http://127.0.0.1:8790", SECRET);
    await expect(p.presignGet(FILM, 60)).rejects.toThrow(/minio|s3/i);
    try {
      await p.presignGet(FILM, 60);
      throw new Error("expected presignGet to throw");
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
    }
  });

  // POSITIVE CONTROL: the two assertions above (never contains the token; throws instead of a URL)
  // are not vacuous. This is a frozen copy of what LocalObjectPresigner.presignGet did BEFORE
  // local#309: silently dropped `_expiresSec` and returned a URL carrying the full studio bearer
  // token. Run through the same shape of check, it trips both: an identical URL regardless of the
  // requested lifetime (the TTL is a dead parameter), and a URL containing the token verbatim.
  it("positive control: the pre-fix behavior trips the TTL-drop and token-embed checks", async () => {
    class PreFix309Presigner {
      constructor(
        private readonly publicBase: string,
        private readonly token?: string,
      ) {}
      async presignGet(key: string, _expiresSec?: number): Promise<string> {
        const q = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
        return `${this.publicBase}/api/artifact/${encodeURIComponent(key)}${q}`;
      }
    }
    const bad = new PreFix309Presigner("http://127.0.0.1:8790", SECRET);
    const url60 = await bad.presignGet(FILM, 60);
    const url3600 = await bad.presignGet(FILM, 3600);
    // dropped TTL: the URL does not vary with the requested lifetime at all.
    expect(url60).toBe(url3600);
    // embedded token: the exact leak the fix exists to close.
    expect(url60).toContain(encodeURIComponent(SECRET));
  });
});
