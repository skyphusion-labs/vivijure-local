// local#401: renders.finish_elapsed_ms arrived with migration 0019 and ZERO producers on this host.
// The five CPU containers now emit the cf#268 `elapsedMs` each one measured for its OWN stage, which
// is what the shared orchestrator sums into the column. This file is the guard that keeps them,
// because the defect was not a wrong value: it was a well-named column whose producer could
// silently disappear and leave a permanent NULL that reads as "not measured".
//
// Every block carries a control, because a NULL column and an unrun test render identically:
//
//   1. THE PRODUCERS EXIST, read out of the SHIPPED container sources (no fixture copy). The scanner
//      is then shown going to ZERO on the same source with the emission stripped, so a green here is
//      a green that could have gone red.
//   2. THE WIRE KEY MATCHES AT BOTH ENDS. The emitted key is parsed from containers/*/app.py and the
//      consumed key is parsed from the INSTALLED @skyphusion-labs/vivijure-core. Neither side is
//      typed into this file, so a rename on either side reds this test instead of silently
//      reintroducing the NULL.
//   3. THE COLUMN CARRIES IT, through the shipped migration and the shipped statement: a measured
//      value lands non-NULL on a completed finish, an ABSENT measurement stays NULL, and a REPORTED
//      ZERO stays 0. Absent and zero are different states and both directions are asserted
//      (vivijure-cf modules/_shared/runpod-job-log.ts: a reported zero is kept as zero).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import type { Database } from "../src/platform/types.js";
import {
  insertRender,
  listRendersForUser,
  markFinishDone,
  toPublicRenderRow,
} from "@skyphusion-labs/vivijure-core/renders-db";
import { accumulateFinishElapsed } from "@skyphusion-labs/vivijure-core/film-orchestrator";

const ROOT = join(import.meta.dirname, "..");

// Container -> how many stages of that container report their own wall clock. video-finish serves
// three finish stages (/finish assemble-or-mux, /film-titles, /subtitle), each timed on its own.
// Mirrors vivijure-cf exactly; a cf stage added without a local emitter reds the count here.
const STAGES: Record<string, number> = {
  "video-finish": 3,
  "image-prep": 1,
  "audio-beat-sync": 1,
  "audio-mix": 1,
  "audio-master": 1,
};
const TOTAL_STAGES = Object.values(STAGES).reduce((a, b) => a + b, 0);

function containerSource(name: string): string {
  return readFileSync(join(ROOT, "containers", name, "app.py"), "utf8");
}
function countEmissions(src: string): number {
  return (src.match(/"elapsedMs":\s*_elapsed_ms\(t0\)/g) ?? []).length;
}
function countTimedStages(src: string): number {
  return (src.match(/\bt0 = time\.monotonic\(\)/g) ?? []).length;
}
function emittedKeys(src: string): string[] {
  return [...src.matchAll(/"([A-Za-z_]+)":\s*_elapsed_ms\(t0\)/g)].map((m) => m[1]);
}

// The installed core, resolved through node rather than a hand-built path, so this reads the same
// dependency the studio actually runs.
const CORE_DIST = join(
  dirname(createRequire(import.meta.url).resolve("@skyphusion-labs/vivijure-core/package.json")),
  "dist",
);
function consumedElapsedKeys(): { keys: Set<string>; sites: number } {
  const keys = new Set<string>();
  let sites = 0;
  for (const f of ["film-orchestrator.js", "scatter-orchestrator.js"]) {
    const src = readFileSync(join(CORE_DIST, f), "utf8");
    for (const m of src.matchAll(/accumulateFinishElapsed\(job,\s*body\.([A-Za-z_]+)\)/g)) {
      keys.add(m[1]);
      sites += 1;
    }
  }
  return { keys, sites };
}

/** Temp SQLite dirs created by realDb(); reaped afterEach, never by glob (local#308). */
const liveTempDirs: string[] = [];

function realDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), `vj-elapsed401-${process.pid}-`));
  liveTempDirs.push(dir);
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(ROOT, "migrations"));
  return openDatabase(dbPath);
}

type CoreEnv = Parameters<typeof insertRender>[0];
const envFor = (db: Database): CoreEnv => ({ DB: db }) as unknown as CoreEnv;

/** Insert one render and complete its finish leg exactly as the orchestrator does. */
async function completedFinish(
  db: Database,
  jobId: string,
  finishElapsedMs?: number | null,
): Promise<ReturnType<typeof toPublicRenderRow>> {
  const env = envFor(db);
  expect(
    await insertRender(env, {
      jobId,
      project: "local401",
      bundleKey: "bundles/local401.tar.gz",
      qualityTier: "final",
      status: "IN_QUEUE",
    }),
  ).toBe(true);
  await markFinishDone(env, jobId, "renders/local401.mp4", JSON.stringify({ ok: true }), null, finishElapsedMs);
  const rows = await listRendersForUser(env, 50);
  const row = rows.find((r) => r.job_id === jobId);
  expect(row, `render ${jobId} must exist`).toBeDefined();
  return toPublicRenderRow(row!);
}

afterEach(() => {
  if (process.env.VJ_KEEP_TEST_DB) {
    liveTempDirs.length = 0;
    return;
  }
  while (liveTempDirs.length > 0) rmSync(liveTempDirs.pop()!, { recursive: true, force: true });
});

describe("the producers exist in the shipped containers (local#401)", () => {
  it("POSITIVE CONTROL: prints the denominator, so a pass cannot be an unrun scan", () => {
    let containers = 0;
    let emissions = 0;
    let timed = 0;
    for (const name of Object.keys(STAGES)) {
      const src = containerSource(name);
      containers += 1;
      emissions += countEmissions(src);
      timed += countTimedStages(src);
    }
    console.log(
      `local#401 producer scan: ${containers}/${Object.keys(STAGES).length} containers read, ` +
        `${emissions}/${TOTAL_STAGES} emission sites found, ${timed}/${TOTAL_STAGES} stages measuring their own wall clock`,
    );
    expect(containers).toBe(Object.keys(STAGES).length);
    expect(emissions).toBe(TOTAL_STAGES);
    expect(timed).toBe(TOTAL_STAGES);
  });

  for (const [name, stages] of Object.entries(STAGES)) {
    it(`${name} defines the helper, imports time, and emits on all ${stages} stage(s)`, () => {
      const src = containerSource(name);
      expect(src).toMatch(/^import time$/m);
      expect(src).toMatch(/^def _elapsed_ms\(t0: float\) -> int:$/m);
      // The measurement is the container's OWN monotonic wall clock for its stage, never a
      // timestamp difference handed to it by the studio.
      expect(src).toMatch(/return max\(0, int\(round\(\(time\.monotonic\(\) - t0\) \* 1000\)\)\)/);
      expect(countEmissions(src)).toBe(stages);
      expect(countTimedStages(src)).toBe(stages);
    });
  }

  it("NEGATIVE CONTROL: the scanner reports ZERO once the emission is deleted (it can go red)", () => {
    const src = containerSource("video-finish");
    expect(countEmissions(src)).toBe(STAGES["video-finish"]);
    // Same source, emission lines removed: this is exactly the pre-fix tree, and the scanner must
    // be able to see it. A guard that cannot report the defect it exists for is decoration.
    const stripped = src.replace(/^.*"elapsedMs".*\n/gm, "");
    expect(countEmissions(stripped)).toBe(0);
  });
});

describe("the wire key matches at both ends (local#401)", () => {
  it("every container emits the SAME key, parsed from the container sources", () => {
    const keys = new Set(Object.keys(STAGES).flatMap((n) => emittedKeys(containerSource(n))));
    expect([...keys]).toEqual(["elapsedMs"]);
  });

  it("the key the INSTALLED core consumes is the key the containers emit", () => {
    const { keys: consumed, sites } = consumedElapsedKeys();
    // CONTROL: the matcher found the consumer at all. A zero here would make the comparison below
    // pass against an empty set, which is the shape of the bug this file is about.
    console.log(`local#401 core consume sites: ${sites} accumulateFinishElapsed call(s) reading body.[${[...consumed].join(", ")}]`);
    expect(sites).toBeGreaterThan(0);
    const emitted = new Set(Object.keys(STAGES).flatMap((n) => emittedKeys(containerSource(n))));
    expect([...consumed].sort()).toEqual([...emitted].sort());
  });
});

describe("the column carries it, against the shipped migration (local#401)", () => {
  it("CONTROL: finish_elapsed_ms exists and the probe returns 0 for a column that does not", async () => {
    const db = realDb();
    const present = await db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('renders') WHERE name = ?")
      .bind("finish_elapsed_ms")
      .first<{ n: number }>();
    expect(present?.n).toBe(1);
    const absent = await db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('renders') WHERE name = ?")
      .bind("no_such_column")
      .first<{ n: number }>();
    expect(absent?.n).toBe(0);
  });

  it("a completed finish step lands a NON-NULL value on the render row", async () => {
    const row = await completedFinish(realDb(), "job-measured", 4321);
    expect(row.status).toBe("COMPLETED");
    expect(row.finish_elapsed_ms).not.toBeNull();
    expect(row.finish_elapsed_ms).toBe(4321);
  });

  it("ABSENT stays NULL: this is the pre-fix state, and it must remain distinguishable", async () => {
    const row = await completedFinish(realDb(), "job-unmeasured", undefined);
    expect(row.status).toBe("COMPLETED");
    expect(row.finish_elapsed_ms).toBeNull();
  });

  it("a REPORTED ZERO is kept as ZERO, not coerced to NULL", async () => {
    const row = await completedFinish(realDb(), "job-zero", 0);
    expect(row.finish_elapsed_ms).toBe(0);
    expect(row.finish_elapsed_ms).not.toBeNull();
  });

  it("the two states are not the same value (0 and NULL are told apart end to end)", async () => {
    const db = realDb();
    const zero = await completedFinish(db, "job-zero-2", 0);
    const absent = await completedFinish(db, "job-absent-2", null);
    expect(zero.finish_elapsed_ms).toBe(0);
    expect(absent.finish_elapsed_ms).toBeNull();
    expect(zero.finish_elapsed_ms).not.toBe(absent.finish_elapsed_ms);
  });
});

describe("the whole path, container body to column (local#401)", () => {
  // The body key is not typed here: it is the key PARSED out of the shipped container source, so
  // this drives core's accumulator with the field the container actually puts on the wire.
  function bodyFromContainer(name: string, value: unknown): Record<string, unknown> {
    const keys = emittedKeys(containerSource(name));
    expect(keys.length).toBeGreaterThan(0);
    return { ok: true, [keys[0]]: value };
  }

  it("an emitted measurement reaches the column NON-NULL", async () => {
    const job: { finish_elapsed_ms?: number } = {};
    const body = bodyFromContainer("video-finish", 1500) as { elapsedMs?: unknown };
    accumulateFinishElapsed(job, body.elapsedMs);
    expect(job.finish_elapsed_ms).toBe(1500);
    const row = await completedFinish(realDb(), "job-wired", job.finish_elapsed_ms);
    expect(row.finish_elapsed_ms).toBe(1500);
  });

  it("the SUM of the stages is what lands, not the last one", async () => {
    const job: { finish_elapsed_ms?: number } = {};
    for (const ms of [1200, 800, 40]) {
      const body = bodyFromContainer("video-finish", ms) as { elapsedMs?: unknown };
      accumulateFinishElapsed(job, body.elapsedMs);
    }
    const row = await completedFinish(realDb(), "job-summed", job.finish_elapsed_ms);
    expect(row.finish_elapsed_ms).toBe(2040);
  });

  it("DISCRIMINATES: a body with NO elapsedMs (the pre-fix container) leaves the column NULL", async () => {
    const job: { finish_elapsed_ms?: number } = {};
    const preFix = { ok: true } as { elapsedMs?: unknown };
    accumulateFinishElapsed(job, preFix.elapsedMs);
    expect(job.finish_elapsed_ms).toBeUndefined();
    const row = await completedFinish(realDb(), "job-prefix-body", job.finish_elapsed_ms);
    expect(row.finish_elapsed_ms).toBeNull();
  });

  it("a garbage measurement is refused rather than stored as a number", async () => {
    for (const bad of ["12", -1, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      const job: { finish_elapsed_ms?: number } = {};
      accumulateFinishElapsed(job, bad);
      expect(job.finish_elapsed_ms, String(bad)).toBeUndefined();
    }
  });
});
