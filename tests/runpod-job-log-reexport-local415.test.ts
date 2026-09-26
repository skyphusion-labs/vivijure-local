// local#415: src/runpod-job-log.ts stopped being an implementation and became a POINTER at
// vivijure-core, so this door stops carrying the last drifted private copy of a rule the estate
// already owns once. Ported from vivijure-cf tests/runpod-job-log-reexport-cf475.test.ts; the
// additions here are the ones cf did not need (the timing migration, and the host-only wrapper).
//
// BOTH FAILURE MODES OF THIS MOVE ARE SILENT, which is why these assertions exist rather than
// trusting a deletion to stay done:
//
//   1. THE RE-EXPORT STOPS COVERING WHAT THE HOST IMPORTS. src/platform/modules.ts takes DETAIL_MAX
//      and RunpodJobOutcome through this specifier and src/modules/runpod/shared.ts takes
//      parseRunpodErrorType. tsc catches a missing export for code it compiles; this asserts the
//      surface at RUNTIME, through the same specifier those files use.
//   2. A HAND COPY COMES BACK. Sync-checking the copy you KEPT protects only the copy you kept. This
//      file's whole value is that the pointer holds nothing, and an absence decays with nothing
//      noticing. So the assertion is IDENTITY, not shape: a re-forked local implementation with a
//      matching surface passes every name-only comparison and IS the defect being removed.
//
// The estate has the receipt. Re-measured 2026-09-26 against core 1.22.5, the copy that stood here
// carried DETAIL_MAX = 160 where cf#320 raised it to 480, had no `unknown` outcome, no
// RESOLVED_RUNPOD_OUTCOMES, no timingFromStatus and no timing columns, no reconciler and no readiness
// probe. Drift on this file is measured history, not a hypothetical.
import { describe, expect, it, afterEach, vi } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import type { Database } from "../src/platform/types.js";
import { HttpModuleTransport, type ModuleJobEvent } from "../src/platform/modules.js";
import { runpodJobRecorder } from "../src/runpod-job-recorder.js";
import * as viaHost from "../src/runpod-job-log.js";
import * as viaCore from "@skyphusion-labs/vivijure-core/runpod-job-log";

const REPO = join(import.meta.dirname, "..");
const MIGRATIONS = join(REPO, "migrations");
const POINTER = join(REPO, "src", "runpod-job-log.ts");

/** Temp dirs this file created; reaped in afterEach. Removed by EXACT path, never by glob. */
const liveTempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `vj-415-${process.pid}-`));
  liveTempDirs.push(dir);
  return dir;
}

/** A migrated studio.db, by default with the FULL migration set. */
function realDb(migrationsDir: string = MIGRATIONS): Database {
  const dbPath = join(tempDir(), "studio.db");
  migrateDatabase(dbPath, migrationsDir);
  return openDatabase(dbPath);
}

/** The migration set as it stood BEFORE 0022: the seven-column table core's upsert cannot write. */
function migrationsWithout0022(): string {
  const dir = tempDir();
  for (const f of readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f))) {
    copyFileSync(join(MIGRATIONS, f), join(dir, f));
  }
  unlinkSync(join(dir, "0022_runpod_job_log_timing.sql"));
  return dir;
}

async function rows(db: Database): Promise<Record<string, unknown>[]> {
  const r = await db.prepare("SELECT * FROM runpod_job_log ORDER BY job_id").all();
  return (r.results ?? []) as Record<string, unknown>[];
}

async function columnCount(db: Database, name: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('runpod_job_log') WHERE name = ?")
    .bind(name)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (liveTempDirs.length > 0) rmSync(liveTempDirs.pop()!, { recursive: true, force: true });
});

describe("src/runpod-job-log.ts re-exports core and adds nothing (local#415)", () => {
  it("exposes the SAME export names as core, derived from both sides rather than listed here", () => {
    // Derived on both sides on purpose. A hardcoded name list would be a third copy of the contract,
    // written into the test whose job is to stop there being a second one.
    const host = Object.keys(viaHost).sort();
    const core = Object.keys(viaCore).sort();
    expect(host.length).toBeGreaterThan(0); // floor: two empty namespaces are trivially equal
    expect(host).toEqual(core);
  });

  it("re-exports the SAME objects, not lookalikes", () => {
    // IDENTITY, not shape. This is the assertion a re-forked copy cannot pass.
    expect(viaHost.recordRunpodJob).toBe(viaCore.recordRunpodJob);
    expect(viaHost.RUNPOD_JOB_LOG_UPSERT).toBe(viaCore.RUNPOD_JOB_LOG_UPSERT);
    expect(viaHost.parseRunpodErrorType).toBe(viaCore.parseRunpodErrorType);
    expect(viaHost.boundDetail).toBe(viaCore.boundDetail);
    expect(viaHost.timingFromStatus).toBe(viaCore.timingFromStatus);
    expect(viaHost.probeRunpodJobLog).toBe(viaCore.probeRunpodJobLog);
    expect(viaHost.reconcileOpenRunpodJobs).toBe(viaCore.reconcileOpenRunpodJobs);
  });

  it("DECLARES NOTHING OF ITS OWN -- the guard on the deletion, not on the survivor", () => {
    const src = readFileSync(POINTER, "utf8");
    // Comments are stripped FIRST. Without that, the file's own prose ("if you are about to add a
    // `const`, a `function`...") trips every matcher below, and a guard its own documentation fails
    // is a guard someone deletes.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    // Positive control on the stripper: the declaration keyword must be findable in a string KNOWN
    // to contain one, or "no declarations" is a claim about a matcher that matches nothing.
    expect(/\bexport\s+const\b/.test("export const X = 1;")).toBe(true);
    expect(/\b(const|function|class|interface|enum)\s+[A-Za-z_]/.test("function f() {}")).toBe(true);
    expect(code).not.toMatch(/\bexport\s+(const|function|class|interface|type|enum)\b/);
    expect(code).not.toMatch(/\b(const|function|class|interface|enum)\s+[A-Za-z_]/);
    // And it must still be a re-export of core, so "declares nothing" cannot be satisfied by an
    // empty file that silently breaks every host importer.
    expect(code).toMatch(/export\s+\*\s+from\s+["']@skyphusion-labs\/vivijure-core\/runpod-job-log["']/);
    // The host-only wrapper moved OUT rather than being kept beside the pointer, so assert it is
    // gone from here by name; keeping it would have been the first crack in the guarded file.
    expect(code).not.toMatch(/runpodJobRecorder/);
  });
});

describe("the cf#320 bound arrives THROUGH the pointer (the user-visible half of local#415)", () => {
  it("DETAIL_MAX is core's 480, not the 160 this door used to carry", () => {
    expect(viaHost.DETAIL_MAX).toBe(viaCore.DETAIL_MAX);
    expect(viaHost.DETAIL_MAX).toBe(480);
    // Named explicitly: the old value is the defect, and a future core regression to it fails here
    // rather than showing up as a truncated diagnosis in an operator's log.
    expect(viaHost.DETAIL_MAX).toBeGreaterThan(160);
  });

  it("a real row keeps a refusal tail that the old 160 bound cut in half", async () => {
    const db = realDb();
    // Shaped like the measured cf#320 refusal: the actionable part (the expected project) sits at
    // the END, which is exactly what a 160-char cut removed.
    const detail =
      "HarnessError: preview: bundle_key: " +
      "a/".repeat(100) +
      " must belong to project 'lighthouse_smoke2b'";
    expect(detail.length).toBeGreaterThan(160);
    expect(detail.length).toBeLessThanOrEqual(480);
    await viaHost.recordRunpodJob(db, { jobId: "j-320", module: "own-gpu", outcome: "failed", detail });
    const [row] = await rows(db);
    expect(row.detail).toBe(detail); // whole string, marker and all absent because nothing was cut
    expect(String(row.detail)).toContain("lighthouse_smoke2b");
    expect(String(row.detail).length).toBeGreaterThan(160);
  });

  it("DISCRIMINATES: past 480 it still cuts, and the cut is VISIBLE", async () => {
    // Without this, "the tail survived" could be satisfied by a bound of Infinity, which is a
    // different defect (an unbounded operator string widening the row).
    const db = realDb();
    await viaHost.recordRunpodJob(db, { jobId: "j-cut", module: "own-gpu", outcome: "failed", detail: "x".repeat(5000) });
    const [row] = await rows(db);
    expect(String(row.detail).length).toBe(480);
    expect(String(row.detail).endsWith(viaHost.DETAIL_TRUNCATION_MARKER)).toBe(true);
  });

  it("reaches the transport seam, which is where the 160 actually bit", async () => {
    // src/platform/modules.ts imports DETAIL_MAX through this pointer and bounds a poll error with
    // it. That file is NOT touched by local#415, so this asserts the fix arrives at the seam by
    // the re-export alone.
    const seen: ModuleJobEvent[] = [];
    const t = new HttpModuleTransport(new Map([["MODULE_FINISH_UPSCALE", "http://127.0.0.1:9112"]]), (e) => seen.push(e));
    const stub = (body: unknown) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
      );
    const post = async (path: string, body: unknown) => {
      const f = t.resolve("MODULE_FINISH_UPSCALE");
      expect(f).not.toBeNull();
      await f!.fetch(new Request("https://module" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      await new Promise((r) => setTimeout(r, 0));
    };
    stub({ ok: true, pending: true, jobId: "j1", poll: "tok1" });
    await post("/invoke", { hook: "finish" });
    stub({ ok: false, error: "y".repeat(5000) });
    await post("/poll", { poll: "tok1" });
    expect(seen[1].outcome).toBe("failed");
    expect(seen[1].detail?.length).toBe(480);
  });
});

describe("the cf#298 vocabulary arrives THROUGH the pointer", () => {
  it("RESOLVED_RUNPOD_OUTCOMES is core's, and excludes the one outcome that means we stopped asking", () => {
    expect(viaHost.RESOLVED_RUNPOD_OUTCOMES).toBe(viaCore.RESOLVED_RUNPOD_OUTCOMES);
    expect(viaHost.RESOLVED_RUNPOD_OUTCOMES).toContain("cancelled");
    expect(viaHost.RESOLVED_RUNPOD_OUTCOMES).not.toContain("unknown");
    expect(viaHost.isResolvedRunpodOutcome("cancelled")).toBe(true);
    expect(viaHost.isResolvedRunpodOutcome("unknown")).toBe(false);
  });

  it("`unknown` is writable here now, which is the outcome this door could not express at all", async () => {
    const db = realDb();
    await viaHost.recordRunpodJob(db, { jobId: "j-unk", module: "own-gpu", outcome: "unknown" }, 1_700_000_060_000);
    const [row] = await rows(db);
    expect(row.outcome).toBe("unknown");
    // Terminal, so it closes the row rather than leaving it reading as in-flight forever.
    expect(row.terminal_at).toBe(1_700_000_060);
  });
});

describe("migrations/0022 is LOAD-BEARING, not decorative", () => {
  it("the timing columns exist, with a control that the probe can return 0", async () => {
    const db = realDb();
    expect(await columnCount(db, "execution_ms")).toBe(1);
    expect(await columnCount(db, "delay_ms")).toBe(1);
    // CONTROL: the same probe returns 0 for a column that does not exist, so the 1s above are a
    // measurement and not a query that returns 1 for anything.
    expect(await columnCount(db, "no_such_column")).toBe(0);
  });

  it("core's NINE-column upsert lands a ROW with the timing values in it", async () => {
    const db = realDb();
    await viaHost.recordRunpodJob(
      db,
      { jobId: "j-t", module: "own-gpu", outcome: "completed", submittedAtMs: 1_700_000_000_000, ...viaHost.timingFromStatus({ executionTime: 4321, delayTime: 87 }) },
      1_700_000_060_000,
    );
    const [row] = await rows(db);
    // Assert the ROW, never the absence of an exception: the recorder swallows its own write failure
    // by contract, so "it did not throw" is exactly the reading this test must not accept.
    expect(row.execution_ms).toBe(4321);
    expect(row.delay_ms).toBe(87);
    expect(row.outcome).toBe("completed");
  });

  it("NULL not ZERO: an envelope with no timing lands NULL, and a reported 0 stays 0", async () => {
    const db = realDb();
    await viaHost.recordRunpodJob(db, { jobId: "j-a", module: "m", outcome: "cancelled", ...viaHost.timingFromStatus({}) }, 1_700_000_060_000);
    await viaHost.recordRunpodJob(db, { jobId: "j-b", module: "m", outcome: "completed", ...viaHost.timingFromStatus({ executionTime: 0, delayTime: 0 }) }, 1_700_000_060_000);
    const [a, b] = await rows(db);
    expect(a.execution_ms).toBeNull();
    expect(a.delay_ms).toBeNull();
    expect(b.execution_ms).toBe(0);
    expect(b.delay_ms).toBe(0);
  });

  it("WITHOUT 0022 the shared write lands NO ROW, silently -- the failure this ordering avoids", async () => {
    // The whole reason local#415 could not be collapsed into one step. Core binds nine columns; the
    // pre-0022 table has seven. The recorder warns and returns rather than failing a render, so the
    // symptom is an empty table and a working studio. Proven, not asserted from the issue.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = realDb(migrationsWithout0022());
    expect(await columnCount(db, "execution_ms")).toBe(0); // control: this really is the old schema
    await expect(
      viaHost.recordRunpodJob(db, { jobId: "j-pre", module: "m", outcome: "submitted", submittedAtMs: 1_700_000_000_000 }),
    ).resolves.toBeUndefined();
    expect(await rows(db)).toHaveLength(0);
    expect(warn).toHaveBeenCalled(); // it is a LOUD no-op in the log, even though the caller sees nothing
    warn.mockRestore();
  });
});

describe("runpodJobRecorder stays host-only glue over the SHARED recorder", () => {
  it("writes a real row through the same code core owns", async () => {
    const db = realDb();
    runpodJobRecorder(db)({ jobId: "j-w", module: "finish-upscale", outcome: "submitted", submittedAtMs: 1_700_000_000_000 });
    // Fire-and-forget by contract, so let the microtask and the write settle.
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await rows(db);
    expect(row.job_id).toBe("j-w");
    expect(row.module).toBe("finish-upscale");
    expect(row.terminal_at).toBeNull();
  });

  it("cannot throw at its caller even with no database, because a render must not depend on telemetry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => runpodJobRecorder(undefined)({ jobId: "j", module: "m", outcome: "failed" })).not.toThrow();
    warn.mockRestore();
  });
});
