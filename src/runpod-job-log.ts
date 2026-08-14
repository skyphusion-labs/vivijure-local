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
 *  Closed set matches cf. Producers on THIS door (local#304): the module poll carries a structured
 *  `outcome` on the envelope for gone / backend-error / failed / cancelled; the studio transport
 *  records that field and never parses the English `error` string. Pre-#304, gone and backend-error
 *  were collapsed into prose and unreachable in the log; that is fixed.
 *
 *  cancelled (cf#298, cf PR #304) names an observed RunPod CANCELLED status, not a deliberate
 *  refusal. Refusals are discriminated by error_type (cf#286 / cf#288), NOT by this value. */
export type RunpodJobOutcome =
  | "submitted"
  | "completed"
  | "degraded"
  | "backend-error"
  | "failed"
  | "gone"
  | "cancelled";

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
  /** Machine label for the fault CLASS (cf#288), e.g. HarnessError. Bounded to ERROR_TYPE_MAX.
   *  OMIT IT rather than passing a placeholder when the endpoint did not report one: NULL means
   *  "not told", which must stay distinguishable from "told, and it was not a refusal". */
  errorType?: string;
}

/** Same bound cf applies, and the same one the module poll paths already apply to an error string. */
export const DETAIL_MAX = 160;

/** A class name, not prose. Generous enough for a fully-qualified python class, short enough that a
 *  vendor deciding to put a sentence in this key cannot widen the row. Verbatim from cf. */
export const ERROR_TYPE_MAX = 80;

/** A write on this path must not outlive a poll tick. Past this the write is abandoned, warned, and the
 *  caller proceeds; the row is lost, which is the correct trade for best-effort telemetry. This bound
 *  covers the retry too, so the caller's worst case is unchanged from before the retry existed. */
export const RUNPOD_JOB_LOG_TIMEOUT_MS = 2000;

/** cf#298: one bounded retry on a failed write, INSIDE the existing timeout budget.
 *
 *  WHY. The terminal write happens when a module poll returns a terminal envelope. Nothing polls that
 *  job again afterwards, so a write lost to a transient database error is lost PERMANENTLY: the row
 *  stays submitted and reads as an in-flight job forever. Measured on cf at 2 of 20 module jobs in a
 *  run with zero actual faults, i.e. a perfect run presenting as 10% unexplained.
 *
 *  WHAT THIS DOES NOT DO, stated plainly so nobody reads cf#298 as closed. It reduces the window; it
 *  does not remove it. An outage longer than the budget still loses the row, and nothing here revisits
 *  a row after the fact. The real fix is a reconciler that re-asks RunPod for rows with terminal_at
 *  IS NULL, under a hard constraint: RunPod keeps async results for ~30 minutes and has no
 *  job-history API, so a reconciler running later than that must record unknown rather than guess.
 *
 *  Safe to repeat: the upsert is keyed on job_id and guarded by WHERE terminal_at IS NULL, so a
 *  second attempt landing after a first one succeeded is a no-op rather than a rewrite. */
export const RUNPOD_JOB_LOG_RETRY_DELAY_MS = 150;

/**
 * Upsert keyed on job_id. The submit write lands submitted with terminal_at NULL; the first terminal
 * write fills outcome, detail and terminal_at.
 *
 * WHERE runpod_job_log.terminal_at IS NULL makes the FIRST terminal write win: a repeated poll after a
 * terminal state is a no-op rather than a rewrite, so the recorded outcome is the one the chain acted
 * on. Verbatim from cf, so a cross-door query cannot need two shapes.
 */
export const RUNPOD_JOB_LOG_UPSERT =
  "INSERT INTO runpod_job_log (job_id, module, outcome, detail, submitted_at, terminal_at, error_type) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
  "ON CONFLICT(job_id) DO UPDATE SET " +
  "outcome = excluded.outcome, " +
  "detail = COALESCE(excluded.detail, runpod_job_log.detail), " +
  "error_type = COALESCE(excluded.error_type, runpod_job_log.error_type), " +
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
    const errorType =
      rec.errorType === undefined || rec.errorType === null || rec.errorType === ""
        ? null
        : String(rec.errorType).slice(0, ERROR_TYPE_MAX);
    const terminalAt = rec.outcome === "submitted" ? null : Math.floor(nowMs / 1000);
    const submittedAt = rec.submittedAtMs === undefined ? null : Math.floor(rec.submittedAtMs / 1000);
    // .then(ok, err) rather than a bare await: the write promise must never be able to reject, or a
    // rejection arriving after the timeout already won the race becomes an unhandled rejection.
    const attempt = (): Promise<"ok" | "failed"> =>
      db
        .prepare(RUNPOD_JOB_LOG_UPSERT)
        .bind(rec.jobId, rec.module, rec.outcome, detail, submittedAt, terminalAt, errorType)
        .run()
        .then(
          () => "ok" as const,
          (e: unknown) => {
            warn("write failed (module=" + rec.module + ", outcome=" + rec.outcome + "): " + describe(e));
            return "failed" as const;
          },
        );
    // cf#298: a lost terminal write never reconciles, so spend one bounded retry on it. Still one
    // race against ONE timer, so the caller's worst-case delay is unchanged.
    const write: Promise<"ok" | "failed"> = attempt().then(async (first) => {
      if (first === "ok") return "ok" as const;
      await new Promise<void>((resolve) => setTimeout(resolve, RUNPOD_JOB_LOG_RETRY_DELAY_MS));
      const second = await attempt();
      if (second !== "ok") {
        warn("write failed twice (module=" + rec.module + ", outcome=" + rec.outcome + ") -- row NOT recorded");
      }
      return second;
    });
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

// ------------------------------------------------------------------------------------------------
// FAULT CLASS EXTRACTION (cf#288): read a STRUCTURED key, or read nothing.
//
// PARITY: byte-for-byte the same behaviour as cf's modules/_shared/runpod-job-log.ts, so a row
// written by either door means the same thing. Kept as a separate exported function rather than
// inlined at the call site for exactly that reason: the two doors have to be comparable.
//
// The RunPod /status `error` field for a vivijure-backend fault is a JSON STRING whose first key is
// `error_type`, e.g. "<class 'vivijure_backend.harness.handler.HarnessError'>". That class is the
// only thing separating a DELIBERATE REFUSAL from an OOM: both arrive as RunPod FAILED and both are
// written as outcome `failed`.
//
// IT RETURNS undefined FOR A BARE ERROR STRING, and that is the point rather than a shortfall. The
// satellite containers return a bare string for BOTH a validation refusal and a genuine crash, so
// there is no class to read; deriving one from the message would be a parser only as fresh as the
// sentence it was built from, and would make the classification LOOK solved on a surface where it is
// not. undefined becomes NULL, and NULL means "not told".
// ------------------------------------------------------------------------------------------------

/** Unwraps python's repr of a class object. "<class 'a.b.C'>" -> "C". Anything else is returned as
 *  given, so a plain class name from a future producer passes through unharmed. */
function normalizeClassName(raw: string): string {
  const m = /^<class\s+'([^']+)'>$/.exec(raw.trim());
  const qualified = m ? m[1] : raw.trim();
  const leaf = qualified.slice(qualified.lastIndexOf(".") + 1);
  return leaf || qualified;
}

/**
 * Extract the fault CLASS from a RunPod /status error field.
 *
 * Accepts the payload in the shapes it actually arrives in: an object, or a JSON string holding an
 * object. Returns undefined when there is no structured `error_type` key. NEVER derives a class from
 * the message.
 */
export function parseRunpodErrorType(err: unknown): string | undefined {
  let obj: unknown = err;
  if (typeof err === "string") {
    try {
      obj = JSON.parse(err);
    } catch {
      // A bare error string carries no class. Saying so is the point; guessing one is the trap.
      return undefined;
    }
  }
  if (!obj || typeof obj !== "object") return undefined;
  const raw = (obj as { error_type?: unknown }).error_type;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return normalizeClassName(raw).slice(0, ERROR_TYPE_MAX);
}
