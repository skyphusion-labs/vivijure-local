// runpod_job_log on the self-host door (local#294): what it writes, and the guarantee that it can
// never break a render.
//
// The never-throw contract is asserted by making each failure mode fail ON PURPOSE and checking the
// caller still completes, because a telemetry helper that is merely NOT OBSERVED to throw is not the
// same as one that cannot. Every negative block carries a positive control: a working database that
// really records, so a suite of passes cannot be produced by a helper that writes nothing at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import type { Database } from "../src/platform/types.js";
import { recordRunpodJob, DETAIL_MAX, ERROR_TYPE_MAX, RUNPOD_JOB_LOG_TIMEOUT_MS, RUNPOD_JOB_LOG_UPSERT } from "../src/runpod-job-log.js";
import { HttpModuleTransport, moduleLabelFromBinding, type ModuleJobEvent } from "../src/platform/modules.js";

function realDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "vj-joblog-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  return openDatabase(dbPath);
}

async function rows(db: Database): Promise<Record<string, unknown>[]> {
  const r = await db.prepare("SELECT * FROM runpod_job_log ORDER BY job_id").all();
  return (r.results ?? []) as Record<string, unknown>[];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what it writes, against the real migration", () => {
  it("the migration actually applied (control: every assertion below is otherwise vacuous)", async () => {
    const db = realDb();
    const t = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
      .bind("table", "runpod_job_log")
      .first<{ name: string }>();
    expect(t?.name).toBe("runpod_job_log");
  });

  it("a submit lands an open row: terminal_at NULL, submitted_at recorded", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j1", module: "finish-upscale", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    const [row] = await rows(db);
    expect(row.outcome).toBe("submitted");
    expect(row.terminal_at).toBeNull();
    expect(row.submitted_at).toBe(1_700_000_000);
    expect(row.module).toBe("finish-upscale");
  });

  it("the terminal write fills outcome, detail and terminal_at", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "failed", submittedAtMs: 1_700_000_000_000, detail: "boom" }, 1_700_000_060_000);
    const [row] = await rows(db);
    expect(row.outcome).toBe("failed");
    expect(row.detail).toBe("boom");
    expect(row.terminal_at).toBe(1_700_000_060);
  });

  it("the FIRST terminal write wins; a later poll is a no-op, not a rewrite", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "completed", submittedAtMs: 1_700_000_000_000 }, 1_700_000_060_000);
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "failed", submittedAtMs: 1_700_000_000_000, detail: "late" }, 1_700_000_120_000);
    const [row] = await rows(db);
    expect(row.outcome).toBe("completed");
    expect(row.terminal_at).toBe(1_700_000_060);
    expect(row.detail).toBeNull();
  });

  it("an unknown submit time stays NULL rather than becoming now", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "completed" }, 1_700_000_060_000);
    const [row] = await rows(db);
    expect(row.submitted_at).toBeNull();
    expect(row.terminal_at).toBe(1_700_000_060);
  });

  it("detail is bounded before it reaches the statement", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j1", module: "m", outcome: "failed", detail: "x".repeat(5000) });
    const [row] = await rows(db);
    expect(String(row.detail).length).toBe(DETAIL_MAX);
  });
});

describe("the best-effort guarantee, each failure mode made to fail on purpose", () => {
  it("a working database DOES record (positive control for this whole block)", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "jc", module: "m", outcome: "submitted" });
    expect((await rows(db)).length).toBe(1);
  });

  it("no database at all: resolves, records nothing", async () => {
    await expect(recordRunpodJob(undefined, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
  });

  it("an empty job id is dropped: nothing to key on", async () => {
    const db = realDb();
    await expect(recordRunpodJob(db, { jobId: "", module: "m", outcome: "failed" })).resolves.toBeUndefined();
    expect((await rows(db)).length).toBe(0);
  });

  it("prepare throws synchronously", async () => {
    const db = { prepare: () => { throw new Error("prepare exploded"); } } as unknown as Database;
    await expect(recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
  });

  it("bind throws synchronously", async () => {
    const db = { prepare: () => ({ bind: () => { throw new Error("bind exploded"); } }) } as unknown as Database;
    await expect(recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
  });

  it("run rejects", async () => {
    const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("write rejected"); } }) }) } as unknown as Database;
    await expect(recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
  });

  it("a thrown non-Error does not become a crash", async () => {
    const db = { prepare: () => { throw "a bare string"; } } as unknown as Database;
    await expect(recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
  });

  it("run HANGS: the write is abandoned at the timeout and the caller proceeds", async () => {
    vi.useFakeTimers();
    const db = { prepare: () => ({ bind: () => ({ run: () => new Promise(() => {}) }) }) } as unknown as Database;
    const p = recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" });
    await vi.advanceTimersByTimeAsync(RUNPOD_JOB_LOG_TIMEOUT_MS + 100);
    await expect(p).resolves.toBeUndefined();
  });
});

describe("the transport seam: what the studio can observe, and what it must not disturb", () => {
  const URLS = new Map([["MODULE_FINISH_UPSCALE", "http://127.0.0.1:9112"]]);

  function stubJson(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
    );
  }

  /** The observation runs on a microtask after the response is handed back, deliberately, so the
      caller is never delayed by it. Tests therefore have to let that turn run. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  async function post(t: HttpModuleTransport, path: string, body: unknown): Promise<Response> {
    const f = t.resolve("MODULE_FINISH_UPSCALE");
    expect(f).not.toBeNull();
    return await f!.fetch(
      new Request("https://module" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("a submit is recorded, and the caller still gets the whole body (not consumed by observing it)", async () => {
    const seen: ModuleJobEvent[] = [];
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    const res = await post(t, "/invoke", { hook: "finish" });
    const body = (await res.json()) as { jobId?: string };
    expect(body.jobId).toBe("j1");
    await settle();
    expect(seen.length).toBe(1);
    expect(seen[0].outcome).toBe("submitted");
    expect(seen[0].jobId).toBe("j1");
    expect(seen[0].module).toBe("finish-upscale");
  });

  it("a terminal poll on that token records completed", async () => {
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    await post(t, "/invoke", { hook: "finish" });
    await settle();
    stubJson({ ok: true, output: { clip_key: "clips/s1.mp4" } });
    await post(t, "/poll", { poll: "tok1" });
    await settle();
    expect(seen.map((e) => e.outcome)).toEqual(["submitted", "completed"]);
    expect(seen[1].jobId).toBe("j1");
  });

  it("a failed poll records failed with a BOUNDED detail", async () => {
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    await post(t, "/invoke", { hook: "finish" });
    await settle();
    stubJson({ ok: false, error: "y".repeat(5000) });
    await post(t, "/poll", { poll: "tok1" });
    await settle();
    expect(seen[1].outcome).toBe("failed");
    expect(seen[1].detail?.length).toBe(DETAIL_MAX);
  });

  it("a still-pending poll records NOTHING (the open row already says so)", async () => {
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    await post(t, "/invoke", { hook: "finish" });
    await settle();
    stubJson({ ok: true, pending: true });
    await post(t, "/poll", { poll: "tok1" });
    await settle();
    expect(seen.length).toBe(1);
  });

  it("a terminal for a token this process never saw records NOTHING rather than guessing", async () => {
    // The submit happened in a previous studio process. Unknown stays unknown: that job keeps its
    // open row, and nothing is attributed to a job id we cannot name.
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    stubJson({ ok: true, output: {} });
    await post(t, "/poll", { poll: "a-token-from-a-previous-process" });
    await settle();
    expect(seen.length).toBe(0);
  });

  it("a non-RunPod invoke (no job id) records nothing", async () => {
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(URLS, (e) => seen.push(e));
    stubJson({ ok: true, output: { done: true } });
    await post(t, "/invoke", { hook: "cpu.thing" });
    await settle();
    expect(seen.length).toBe(0);
  });

  it("with no recorder the transport is unchanged and the caller is unaffected", async () => {
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    const t = new HttpModuleTransport(URLS);
    const res = await post(t, "/invoke", { hook: "finish" });
    expect(((await res.json()) as { jobId?: string }).jobId).toBe("j1");
  });

  it("a recorder that THROWS cannot break the call (telemetry never breaks a render)", async () => {
    stubJson({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    const t = new HttpModuleTransport(URLS, () => { throw new Error("sink exploded"); });
    const res = await post(t, "/invoke", { hook: "finish" });
    expect(res.status).toBe(200);
    await settle();
  });

  it("the binding label derivation, including the one that does not round-trip", () => {
    expect(moduleLabelFromBinding("MODULE_FINISH_UPSCALE")).toBe("finish-upscale");
    expect(moduleLabelFromBinding("MODULE_KEYFRAME")).toBe("keyframe");
    // Documented divergence: this binding serves the compose service module-plan-enhance, so the
    // label is NOT the manifest name. The column is a machine label for grouping, not a join key.
    expect(moduleLabelFromBinding("MODULE_PLANENHANCE")).toBe("planenhance");
  });
});

// ------------------------------------------------------------------------------------------------
// migrations/0017 + the cf#286/#288/#298 parity (twin of vivijure-cf PR #304). Same realDb harness,
// so every assertion below is against the SHIPPED migration and the SHIPPED statement.
// ------------------------------------------------------------------------------------------------

describe("error_type, against the real migration", () => {
  it("migration 0017 actually applied (control: the assertions below are otherwise vacuous)", async () => {
    const db = realDb();
    const col = await db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('runpod_job_log') WHERE name = ?")
      .bind("error_type")
      .first<{ n: number }>();
    expect(col?.n).toBe(1);
    // CONTROL: the same probe returns 0 for a column that does not exist, so the 1 above is a
    // measurement and not a query that returns 1 for anything.
    const absent = await db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('runpod_job_log') WHERE name = ?")
      .bind("no_such_column")
      .first<{ n: number }>();
    expect(absent?.n).toBe(0);
  });

  it("writes the class on a fault, and NULL when there was none (CONTROL pair)", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "jA", module: "own-gpu", outcome: "failed", submittedAtMs: 1_700_000_000_000, detail: "boom", errorType: "HarnessError" }, 1_700_000_060_000);
    await recordRunpodJob(db, { jobId: "jB", module: "own-gpu", outcome: "failed", submittedAtMs: 1_700_000_000_000, detail: "boom" }, 1_700_000_060_000);
    const [a, b] = await rows(db);
    expect(a.error_type).toBe("HarnessError");
    expect(b.error_type).toBeNull();
  });

  it("an empty class is stored as NULL, not as a blank label", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed", errorType: "" });
    const [row] = await rows(db);
    expect(row.error_type).toBeNull();
  });

  it("bounds the class at the statement so a vendor sentence cannot widen the row", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed", errorType: "y".repeat(500) });
    const [row] = await rows(db);
    expect(String(row.error_type)).toHaveLength(ERROR_TYPE_MAX);
  });

  it("a later CLASSLESS write cannot erase a class an earlier write established", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed", detail: "first", errorType: "HarnessError" }, 1_700_000_060_000);
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "completed" }, 1_700_000_120_000);
    const [row] = await rows(db);
    // first-terminal-write-wins still holds, AND the class survived the classless third write.
    expect(row.outcome).toBe("failed");
    expect(row.error_type).toBe("HarnessError");
    expect(row.terminal_at).toBe(1_700_000_060);
  });

  it("COALESCEs error_type but NOT outcome (control: a matcher for any COALESCE proves nothing)", () => {
    expect(RUNPOD_JOB_LOG_UPSERT).toContain("error_type = COALESCE(excluded.error_type, runpod_job_log.error_type)");
    expect(RUNPOD_JOB_LOG_UPSERT).toContain("outcome = excluded.outcome");
    expect(RUNPOD_JOB_LOG_UPSERT).not.toContain("outcome = COALESCE");
  });
});

describe("cancelled, against the real migration (cf#298)", () => {
  it("stores the value the closed set could not previously express", async () => {
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j", module: "own-gpu", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    await recordRunpodJob(db, { jobId: "j", module: "own-gpu", outcome: "cancelled" }, 1_700_000_060_000);
    const [row] = await rows(db);
    expect(row.outcome).toBe("cancelled");
    expect(row.terminal_at).toBe(1_700_000_060);
  });

  it("DISCRIMINATES: cancelled is TERMINAL, so it closes the row rather than leaving it open", async () => {
    // Without this, a value added to the union but missed by the submitted-only terminal_at rule
    // would store the label and leave terminal_at NULL, which reads as an in-flight job -- exactly
    // the stuck-row state cf#298 is about, reintroduced by the fix for it.
    const db = realDb();
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "cancelled" }, 1_700_000_060_000);
    const [row] = await rows(db);
    expect(row.terminal_at).not.toBeNull();
  });
});

describe("the cf#298 retry", () => {
  it("retries ONCE when the write fails, and the second attempt lands", async () => {
    let attempts = 0;
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("transient");
            return { success: true };
          },
        }),
      }),
    } as unknown as Database;
    await expect(recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" })).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("DISCRIMINATES: a write that succeeds first time is attempted exactly once", async () => {
    // Without this, an unconditional double-write would pass the assertion above while doubling the
    // database traffic of every job in the studio.
    let attempts = 0;
    const db = {
      prepare: () => ({ bind: () => ({ run: async () => { attempts += 1; return { success: true }; } }) }),
    } as unknown as Database;
    await recordRunpodJob(db, { jobId: "j", module: "m", outcome: "failed" });
    expect(attempts).toBe(1);
  });
});
