import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFinishOutput } from "../src/modules/runpod/finish-core.js";
import { parseAudioBeatPlan } from "../src/modules/cpu/beat-sync-core.js";
import { presignS3WithConfig } from "../src/platform/s3-presign.js";
import { openDatabase } from "../src/platform/sqlite.js";
import { HttpFetcher } from "../src/platform/http-fetcher.js";

// Wave-5 local lows: #52 honest empty output, #53 D1-strict binds + batch reads, #54 vhost presign,
// #55 signal forwarding, #56 beat-sync finite guards.

describe("#52 parseFinishOutput does not fabricate an applied tag", () => {
  it("returns applied:[] when the backend omits `applied` (a no-op echo)", () => {
    const out = parseFinishOutput("s1", { clip_key: "renders/p/clips/s1.mp4" }, 24, 96);
    expect(out?.applied).toEqual([]); // pre-fix invented ["finish:applied"]
  });
  it("preserves a real applied array", () => {
    const out = parseFinishOutput("s1", { clip_key: "k", applied: ["finish:lipsync"] }, 24, 96);
    expect(out?.applied).toEqual(["finish:lipsync"]);
  });
});

describe("#56 parseAudioBeatPlan rejects non-finite durations", () => {
  it("returns null when a required duration is non-numeric (would be NaN)", () => {
    expect(parseAudioBeatPlan({ mode: "duration", duration_seconds: "not a number" })).toBeNull();
  });
  it("parses a well-formed plan", () => {
    const p = parseAudioBeatPlan({ mode: "duration", duration_seconds: 12, film_seconds: 12 });
    expect(p?.durationSeconds).toBe(12);
  });
});

describe("#53 SQLite adapter D1-strictness", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  function freshDb() {
    dir = mkdtempSync(join(tmpdir(), "vj-sqlite-"));
    const db = openDatabase(join(dir, "t.db"));
    return db;
  }

  it("throws on an undefined bind (D1 rejects it) instead of silently writing NULL", async () => {
    const db = freshDb();
    await db.prepare("CREATE TABLE t (a TEXT)").run();
    await expect(db.prepare("INSERT INTO t (a) VALUES (?)").bind(undefined).run()).rejects.toThrow(/undefined/);
  });

  it("throws on a plain-object bind instead of writing \"[object Object]\"", async () => {
    const db = freshDb();
    await db.prepare("CREATE TABLE t (a TEXT)").run();
    await expect(db.prepare("INSERT INTO t (a) VALUES (?)").bind({ x: 1 }).run()).rejects.toThrow(/unsupported/);
  });

  it("batch() preserves rows for a RETURNING statement (not just {success,meta})", async () => {
    const db = freshDb();
    await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)").run();
    const res = await db.batch!([db.prepare("INSERT INTO t (a) VALUES (?) RETURNING id, a").bind("hi")]);
    const first = res[0] as { results?: Array<{ a: string }> };
    expect(first.results?.[0]?.a).toBe("hi"); // pre-fix: .run() -> no results
  });
});

describe("#54 presignS3WithConfig honors vhost-style", () => {
  const base = {
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    bucket: "mybucket",
    region: "us-east-1",
  };
  it("path-style (default): host is the endpoint, path carries the bucket", async () => {
    const u = await presignS3WithConfig(base, "GET", "clips/s1.mp4", 300, 0);
    expect(u).toMatch(/^https:\/\/s3\.us-east-1\.amazonaws\.com\/mybucket\/clips\/s1\.mp4\?/);
  });
  it("vhost-style (forcePathStyle:false): bucket is a subdomain, path is just the key", async () => {
    const u = await presignS3WithConfig({ ...base, forcePathStyle: false }, "GET", "clips/s1.mp4", 300, 0);
    expect(u).toMatch(/^https:\/\/mybucket\.s3\.us-east-1\.amazonaws\.com\/clips\/s1\.mp4\?/);
  });
});

describe("#55 HttpFetcher forwards the AbortSignal", () => {
  afterEach(() => vi.restoreAllMocks());
  it("passes input.signal through to the outbound fetch", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init: RequestInit) => {
      seen.push(init);
      return new Response("ok");
    }));
    const fetcher = new HttpFetcher("http://127.0.0.1:9000");
    const ac = new AbortController();
    const req = new Request("http://127.0.0.1:9000/x", { signal: ac.signal });
    await fetcher.fetch(req);
    expect(seen[0]?.signal).toBe(req.signal); // the request's signal is forwarded (pre-fix it was dropped -> undefined)
  });
});
