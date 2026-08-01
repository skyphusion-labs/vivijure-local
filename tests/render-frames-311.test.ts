import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { S3ObjectPresigner } from "../src/platform/s3-store.js";
import { ARTIFACT_PREFIXES, safeArtifactContentType } from "../src/artifacts.js";
import {
  buildFramesSheet,
  clampFrameCount,
  parseFrameAt,
  deriveFramesKey,
  gridFor,
  requestFramesFromContainer,
  framesFailure,
  FRAMES_CONTENT_TYPE,
  type FramesFailureState,
} from "../src/render-frames.js";
import { isSafeRelKey } from "../src/shared.js";
import type { FetcherLike, ObjectPresigner, Platform } from "../src/platform/types.js";

// local#311 (cf#322 / cf PR #324 twin): POST /api/render/frames -- sample a rendered clip into ONE jpeg
// contact sheet stored as a normal artifact, so a transport that can carry an image but not a video can
// show motion output.
//
// What these tests are actually for. The design's whole claim is "every existing artifact surface picks
// the sheet up for free", and that claim rests on TWO properties which are invisible in the happy path
// and fail SILENTLY if wrong:
//
//   1. the derived key must be inside ARTIFACT_PREFIXES, or /api/artifact and /api/artifact-url both
//      404 it while every unit test still passes;
//   2. the stored content type must survive safeArtifactContentType, or the sheet is served as
//      application/octet-stream and MCP image-inlining (/^image\//) will not show it.
//
// Both are asserted against LOCAL's REAL exported guards, not a transcribed copy of cf's, each with a
// control that is watched failing. A guard that has never produced its negative is not known to work.
// Local also owns a fifth failure state cf's model does not have: the filesystem storage backend cannot
// presign either end (local#309), which is a storage-configuration state, not a container fault.

const SECRET = "a".repeat(32) + "b".repeat(32);
const CLIP = "renders/film-abc/film.mp4";

const S3_CFG = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "s3cr3t-test-value-not-a-real-key",
  endpoint: "http://127.0.0.1:9000",
  bucket: "vivijure",
  region: "us-east-1",
};

function makePlatform(
  artifactRoot: string,
  presigner: ObjectPresigner,
  hostBindings?: Record<string, FetcherLike>,
): Platform {
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
    ...(hostBindings ? { hostBindings } : {}),
  };
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SECRET}` };
}

/** A container that always succeeds, recording every call so "was it called" is assertable. */
function okVpc(calls: { url: string; body: Record<string, unknown> }[]): FetcherLike {
  return {
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, body: JSON.parse(String(init?.body || "{}")) });
      return new Response(
        JSON.stringify({ ok: true, key: "k", count: 9, frame_times: [1, 2, 3], duration: 5.33 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  };
}

// --- 1. THE PREFIX PROPERTY (the one the whole design rests on) ------------------------------------
describe("local#311 derived key stays inside ARTIFACT_PREFIXES", () => {
  it("the real prefix list is non-empty, so the loop below is not vacuous", () => {
    // Positive control on the TEST ITSELF: an empty list would make every for-of assertion pass
    // without ever executing. This is the assertion that makes the next one mean something.
    expect(ARTIFACT_PREFIXES.length).toBeGreaterThan(5);
  });

  it("preserves the source prefix for EVERY artifact namespace", () => {
    for (const pre of ARTIFACT_PREFIXES) {
      const src = `${pre}some/dir/clip.mp4`;
      for (const count of [1, 4, 9, 25]) {
        const key = deriveFramesKey(src, count, count === 1 ? 2.5 : null);
        expect(key.startsWith(pre), `${key} escaped prefix ${pre}`).toBe(true);
        expect(
          ARTIFACT_PREFIXES.some((p) => key.startsWith(p)),
          `${key} is outside ARTIFACT_PREFIXES`,
        ).toBe(true);
        expect(isSafeRelKey(key), `${key} fails isSafeRelKey`).toBe(true);
      }
    }
  });

  it("CONTROL: a fixed-literal key WOULD escape, so the assertion above can fail", () => {
    // The obvious wrong implementation: put every sheet under a namespace of its own. It reads fine and
    // is unreachable through the artifact routes. Watching this fail is what proves the passing
    // assertion above is doing work.
    const naive = (src: string) => `frames/${src.replace(/\//g, "_")}.jpg`;
    const escaped = naive(CLIP);
    expect(ARTIFACT_PREFIXES.some((p) => escaped.startsWith(p))).toBe(false);
  });

  it("is deterministic, so a repeat request addresses the same object", () => {
    expect(deriveFramesKey(CLIP, 9, null)).toBe(deriveFramesKey(CLIP, 9, null));
    expect(deriveFramesKey(CLIP, 9, null)).toBe("renders/film-abc/frames/film-3x3.jpg");
  });

  it("varies the key by spec, so a 3x3 and a single frame do not collide", () => {
    const sheet = deriveFramesKey(CLIP, 9, null);
    const one = deriveFramesKey(CLIP, 1, 2.5);
    const other = deriveFramesKey(CLIP, 1, 4);
    expect(new Set([sheet, one, other]).size).toBe(3);
  });
});

// --- 2. THE CONTENT-TYPE PROPERTY -------------------------------------------------------------------
describe("local#311 the stored type survives the artifact route's remap", () => {
  it("image/jpeg passes through unchanged AND matches MCP image-inlining", () => {
    expect(safeArtifactContentType(FRAMES_CONTENT_TYPE)).toBe(FRAMES_CONTENT_TYPE);
    // MCP image-inlining accepts only /^image\//. If the remap above ever changed, the sheet would
    // still be served, just never SHOWN -- the silent half of this failure.
    expect(/^image\//i.test(safeArtifactContentType(FRAMES_CONTENT_TYPE))).toBe(true);
  });

  it("CONTROL: a type outside the allowlist IS remapped, so the assertion can fail", () => {
    expect(safeArtifactContentType("text/html")).toBe("application/octet-stream");
    expect(/^image\//i.test(safeArtifactContentType("text/html"))).toBe(false);
  });
});

// --- 3. FAILURE STATES ARE DISTINCT -----------------------------------------------------------------
describe("local#311 failure states are not collapsed", () => {
  const STATES: FramesFailureState[] = [
    "tier-unavailable", "route-not-served", "container-unreachable", "container-error",
    "store-unpresignable",
  ];

  it("every state has its OWN reason string", () => {
    const reasons = STATES.map((s) => framesFailure(s).reason);
    expect(new Set(reasons).size).toBe(STATES.length);
    for (const r of reasons) expect(r.length).toBeGreaterThan(40);
  });

  it("the rollout state says it is expected, so nobody hunts a bug that does not exist", () => {
    const r = framesFailure("route-not-served").reason.toLowerCase();
    expect(r).toContain("expected");
    expect(r).toContain("rollout");
  });

  it("a container 404 is route-not-served, NOT unreachable", async () => {
    const vpc: FetcherLike = { fetch: async () => new Response("nope", { status: 404 }) };
    const r = await requestFramesFromContainer(vpc, {}, { retries: 1, backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect((r as { state: string }).state).toBe("route-not-served");
  });

  it("a transport throw is container-unreachable, NOT route-not-served", async () => {
    const vpc: FetcherLike = {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const r = await requestFramesFromContainer(vpc, {}, { retries: 1, backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect((r as { state: string }).state).toBe("container-unreachable");
  });

  it("a 500 from a serving container is container-error", async () => {
    const vpc: FetcherLike = { fetch: async () => new Response("boom", { status: 500 }) };
    const r = await requestFramesFromContainer(vpc, {}, { retries: 1, backoffMs: 0 });
    expect((r as { state: string }).state).toBe("container-error");
  });

  it("a 200 whose body says ok:false is container-error, not success", async () => {
    const vpc: FetcherLike = {
      fetch: async () =>
        new Response(JSON.stringify({ ok: false, error: "ffmpeg died" }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
    };
    const r = await requestFramesFromContainer(vpc, {}, { retries: 1, backoffMs: 0 });
    expect(r.ok).toBe(false);
    expect((r as { state: string }).state).toBe("container-error");
  });

  it("an unbound tier is reported as a provisioning state, not a fault", async () => {
    let dir = "";
    try {
      dir = mkdtempSync(join(tmpdir(), "vj-frames-tier-"));
      const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG));
      const store = new FilesystemObjectStore(dir);
      await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
      const out = await buildFramesSheet(platform, CLIP, 9, null, { retries: 1, backoffMs: 0 });
      expect(out.ok).toBe(false);
      expect((out as { state: string }).state).toBe("tier-unavailable");
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  // LOCAL-ONLY state: cf's model has no filesystem-backend twin. The filesystem presigner refuses
  // BOTH ends honestly (local#309); that is a storage-configuration fault, not the container's, so it
  // must not be reported as container-error.
  it("a filesystem storage backend is store-unpresignable, NOT a container fault", async () => {
    let dir = "";
    try {
      dir = mkdtempSync(join(tmpdir(), "vj-frames-unpresignable-"));
      const calls: { url: string; body: Record<string, unknown> }[] = [];
      const platform = makePlatform(
        dir,
        new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
        { VIDEO_FINISH_VPC: okVpc(calls) },
      );
      const store = new FilesystemObjectStore(dir);
      await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
      const out = await buildFramesSheet(platform, CLIP, 9, null, { retries: 1, backoffMs: 0 });
      expect(out.ok).toBe(false);
      expect((out as { state: string }).state).toBe("store-unpresignable");
      expect((out as { reason: string }).reason.toLowerCase()).toMatch(/minio|s3/);
      // never a container fault, and never a leaked token in the presigner's own message
      expect((out as { reason: string }).reason).not.toContain(SECRET);
      expect(calls.length).toBe(0);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- 4. IDEMPOTENCE, WITH THE CONTROL THAT MAKES IT MEAN SOMETHING ----------------------------------
describe("local#311 a repeat request reuses the stored sheet", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-frames-idem-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("CONTROL: with no sheet in storage, the container IS called", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: okVpc(calls) });
    const store = new FilesystemObjectStore(dir);
    await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
    const out = await buildFramesSheet(platform, CLIP, 9, null, { retries: 1, backoffMs: 0 });
    expect(out.ok).toBe(true);
    expect((out as { reused: boolean }).reused).toBe(false);
    expect(calls.length).toBe(1); // without this, "not called" below proves nothing
  });

  it("with the sheet already in storage, the container is NOT called", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const sheet = deriveFramesKey(CLIP, 9, null);
    const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: okVpc(calls) });
    const store = new FilesystemObjectStore(dir);
    await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
    await store.put(sheet, new Uint8Array(50), { httpMetadata: { contentType: FRAMES_CONTENT_TYPE } });
    const out = await buildFramesSheet(platform, CLIP, 9, null, { retries: 1, backoffMs: 0 });
    expect(out.ok).toBe(true);
    expect((out as { reused: boolean }).reused).toBe(true);
    expect((out as { key: string }).key).toBe(sheet);
    expect(calls.length).toBe(0);
  });

  it("sends the studio's content type and grid to the container", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: okVpc(calls) });
    const store = new FilesystemObjectStore(dir);
    await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
    await buildFramesSheet(platform, CLIP, 9, null, { retries: 1, backoffMs: 0 });
    expect(calls[0].url).toBe("http://video-finish/frames");
    expect(calls[0].body.contentType).toBe(FRAMES_CONTENT_TYPE);
    expect(calls[0].body.cols).toBe(3);
    expect(calls[0].body.rows).toBe(3);
    expect(String(calls[0].body.videoUrl)).toContain("X-Amz-Signature");
    expect(String(calls[0].body.outputUrl)).toContain("X-Amz-Signature");
  });
});

// --- 5. THE ROUTE: GUARDS AND SHAPE ------------------------------------------------------------------
describe("local#311 POST /api/render/frames", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let calls: { url: string; body: Record<string, unknown> }[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-frames-route-"));
    calls = [];
    const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: okVpc(calls) });
    app = createApp(testSettingsHost(platform));
    const store = new FilesystemObjectStore(dir);
    await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function post(body: unknown) {
    return app.request("/api/render/frames", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  }

  it("refuses a key outside the artifact namespaces", async () => {
    const res = await post({ key: "secrets/prod.env" });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });

  it("refuses a traversal key", async () => {
    const res = await post({ key: "renders/../../etc/passwd" });
    expect(res.status).toBe(404);
  });

  it("404s an artifact that does not exist, rather than signing a miss", async () => {
    const res = await post({ key: "renders/film-nope/film.mp4" });
    expect(res.status).toBe(404);
  });

  it("400s an invalid body", async () => {
    const res = await app.request("/api/render/frames", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns the key, the grid, and the honest scope of the evidence", async () => {
    const res = await post({ key: CLIP });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.key).toBe("renders/film-abc/frames/film-3x3.jpg");
    expect(body.source_key).toBe(CLIP);
    expect(body.content_type).toBe(FRAMES_CONTENT_TYPE);
    expect(body.grid).toEqual({ cols: 3, rows: 3 });
    // The scope of the evidence travels WITH the evidence: a caller cannot quote the sheet as proof
    // the clip was checked, because the response says in words that it is not.
    expect(String(body.proves)).toContain("not about the whole clip");
  });

  it("surfaces the container state and a non-2xx when extraction fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-frames-route-fail-"));
    const failVpc: FetcherLike = { fetch: async () => new Response("nope", { status: 404 }) };
    const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: failVpc });
    app = createApp(testSettingsHost(platform));
    const store = new FilesystemObjectStore(dir);
    await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
    const res = await post({ key: CLIP });
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.state).toBe("route-not-served");
    expect(String(body.error).toLowerCase()).toContain("expected");
  });
});

// --- 6. PARAMETER BANDS ------------------------------------------------------------------------------
describe("local#311 parameter handling", () => {
  it("clampFrameCount defaults, clamps, and never throws", () => {
    expect(clampFrameCount(null)).toBe(9);
    expect(clampFrameCount("")).toBe(9);
    expect(clampFrameCount("abc")).toBe(9);
    expect(clampFrameCount("1")).toBe(1);
    expect(clampFrameCount("0")).toBe(1);
    expect(clampFrameCount("-5")).toBe(1);
    expect(clampFrameCount("25")).toBe(25);
    expect(clampFrameCount("9999")).toBe(25);
  });

  it("parseFrameAt rejects garbage and negatives without throwing", () => {
    expect(parseFrameAt(null)).toBe(null);
    expect(parseFrameAt("abc")).toBe(null);
    expect(parseFrameAt("-1")).toBe(null);
    expect(parseFrameAt("2.5")).toBe(2.5);
    expect(parseFrameAt("0")).toBe(0);
  });

  it("gridFor is square-ish and always has room for every sample", () => {
    for (let n = 1; n <= 25; n++) {
      const g = gridFor(n);
      expect(g.cols * g.rows, `grid too small for ${n}`).toBeGreaterThanOrEqual(n);
    }
    expect(gridFor(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridFor(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(6)).toEqual({ cols: 3, rows: 2 });
  });

  it("`at` is ignored for a sheet, because only a single frame has one timestamp", async () => {
    let dir = "";
    try {
      dir = mkdtempSync(join(tmpdir(), "vj-frames-at-"));
      const calls: { url: string; body: Record<string, unknown> }[] = [];
      const platform = makePlatform(dir, new S3ObjectPresigner(S3_CFG), { VIDEO_FINISH_VPC: okVpc(calls) });
      const app = createApp(testSettingsHost(platform));
      const store = new FilesystemObjectStore(dir);
      await store.put(CLIP, new Uint8Array(100), { httpMetadata: { contentType: "video/mp4" } });
      const res = await app.request("/api/render/frames", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ key: CLIP, count: 9, at: 3 }),
      });
      expect(res.status).toBe(200);
      expect(calls[0].body.at).toBe(null);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });
});
