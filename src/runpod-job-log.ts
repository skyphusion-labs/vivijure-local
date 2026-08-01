// Best-effort durable record of a RunPod job this studio submitted (local#294).
//
// THE ONE HARD GUARANTEE: this helper never throws, never rejects, and never delays its caller by more
// than RUNPOD_JOB_LOG_TIMEOUT_MS. It is telemetry attached to a render path, and a telemetry failure
// that converted a working render into a failed one would be strictly worse than the gap it closes.
// Every exit is a warn plus a return. tests/runpod-job-log-294.test.ts makes each failure mode fail on
// purpose (throwing prepare, throwing bind, rejecting run, hanging run, absent database, non-Error
// throw) and asserts the caller still completes.
//
// WHY THE DATABASE HANDLE IS OPTIONAL. The studio runs in several shapes (a CLI script builds a
// transport with no database), and a missing handle is not a reason to break a render. But absence must
// never be INDISTINGUISHABLE from a clean run, so it warns with its own marker.
//
// PARITY: this is the vivijure-cf twin of modules/_shared/runpod-job-log.ts. Same closed outcome set,
// same bound, same upsert, same never-throw contract. The WRITER differs by design (see
// migrations/0016_runpod_job_log.sql): cf modules write their own row, this door writes studio-side
// because its RunPod sidecars have no database access at all.
import type { Database } from "./platform/types.js";

/** Terminal states observable from the studio side. submitted is the open state.
 *
 *  NOTE, and it is a real limitation of THIS door: backend-error and gone are part of the closed set
 *  for parity with cf, but the studio cannot currently produce them, because the module poll collapses
 *  every failure into {ok:false, error: prose} before the studio sees it. They are kept in the type so
 *  the vocabulary matches cf exactly and so a later fix needs no schema change. */
export type RunpodJobOutcome = "submitted" | "completed" | "backend-error" | "failed" | "gone";

export interface RunpodJobRecord {
  /** RunPod job id. The upsert key; a blank id is dropped (nothing to reconcile against later). */
  jobId: string;
  /** Module label, derived from the MODULE_*_URL binding. Machine generated, never user input. */
  module: string;
  outcome: RunpodJobOutcome;
  /** Submit time in ms. OPTIONAL: an unknown submit time is stored NULL, never as the current time.
   *  An unknown must stay distinguishable from a known one. */
  submittedAtMs?: number;
  /** Error text on a fault outcome. Bounded to DETAIL_MAX before it reaches the statement. */
  detail?: string;
}

/** Same bound cf applies, and the same one the module poll paths already apply to an error string. */
export const DETAIL_MAX = 160;

/** A write on this path must not outlive a poll tick. Past this the write is abandoned, warned, and the
 *  caller proceeds; the row is lost, which is the correct trade for best-effort telemetry. */
export const RUNPOD_JOB_LOG_TIMEOUT_MS = 2000;

/**
 * Upsert keyed on job_id. The submit write lands submitted with terminal_at NULL; the first terminal
 * write fills outcome, detail and terminal_at.
 *
 * WHERE runpod_job_log.terminal_at IS NULL makes the FIRST terminal write win: a repeated poll after a
 * terminal state is a no-op rather than a rewrite, so the recorded outcome is the one the chain acted
 * on. Verbatim from cf, so a cross-door query cannot need two shapes.
 */
export const RUNPOD_JOB_LOG_UPSERT =
  "INSERT INTO runpod_job_log (job_id, module, outcome, detail, submitted_at, terminal_at) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
  "ON CONFLICT(job_id) DO UPDATE SET " +
  "outcome = excluded.outcome, " +
  "detail = COALESCE(excluded.detail, runpod_job_log.detail), " +
  "terminal_at = excluded.terminal_at " +
  "WHERE runpod_job_log.terminal_at IS NULL";

function warn(message: string): void {
  // Marked so a sink can separate telemetry did not record from nothing failed.
  console.warn("runpod-job-log: " + message);
}

/** A thrown value is not necessarily an Error; a thrown string or undefined must not become a crash. */
function describe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "unknown";
}

/**
 * Record one RunPod job outcome. Best-effort by contract: resolves to void on every path.
 *
 * Pass the database straight through; undefined is a supported argument, not a caller bug.
 */
export async function recordRunpodJob(
  db: Database | undefined,
  rec: RunpodJobRecord,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    if (!db) {
      warn("no database (module=" + rec.module + ", outcome=" + rec.outcome + ") -- job NOT recorded");
      return;
    }
    if (!rec.jobId) {
      warn("empty job id (module=" + rec.module + ", outcome=" + rec.outcome + ") -- nothing to key on");
      return;
    }
    const detail = rec.detail === undefined || rec.detail === null ? null : String(rec.detail).slice(0, DETAIL_MAX);
    const terminalAt = rec.outcome === "submitted" ? null : Math.floor(nowMs / 1000);
    const submittedAt = rec.submittedAtMs === undefined ? null : Math.floor(rec.submittedAtMs / 1000);
    // .then(ok, err) rather than a bare await: the write promise must never be able to reject, or a
    // rejection arriving after the timeout already won the race becomes an unhandled rejection.
    const write = db
      .prepare(RUNPOD_JOB_LOG_UPSERT)
      .bind(rec.jobId, rec.module, rec.outcome, detail, submittedAt, terminalAt)
      .run()
      .then(
        () => "ok" as const,
        (e: unknown) => {
          warn("write failed (module=" + rec.module + ", outcome=" + rec.outcome + "): " + describe(e));
          return "failed" as const;
        },
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), RUNPOD_JOB_LOG_TIMEOUT_MS);
    });
    try {
      if ((await Promise.race([write, expiry])) === "timeout") {
        warn(
          "write exceeded " + RUNPOD_JOB_LOG_TIMEOUT_MS + "ms (module=" + rec.module +
            ", outcome=" + rec.outcome + ") -- abandoned",
        );
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (e) {
    // Reached when prepare/bind throw SYNCHRONOUSLY, or db is not the shape we were handed.
    warn("unusable database (module=" + rec.module + ", outcome=" + rec.outcome + "): " + describe(e));
  }
}

/** The recorder handed to createModuleTransport at both construction sites (src/server.ts and
 *  src/platform/reload.ts). Fire-and-forget by design: recordRunpodJob resolves on every path and
 *  never throws, so the caller cannot be delayed or broken by telemetry. Same two-seam shape as the
 *  core#52 metering wrapper, and for the same reason: a reload rebuilds the transport, so a recorder
 *  attached only at boot would silently stop recording the moment an operator saves settings.
 */
export function runpodJobRecorder(db: Database | undefined): (event: RunpodJobRecord) => void {
  return (event: RunpodJobRecord): void => {
    void recordRunpodJob(db, event);
  };
}
