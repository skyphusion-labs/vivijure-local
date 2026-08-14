-- Durable per-job record of every RunPod job this studio submits and polls (local#294).
--
-- PARITY: this is the vivijure-cf twin of migrations/0014_runpod_job_log.sql, and the schema is that
-- file VERBATIM: same columns, same types, same upsert semantics, same closed outcome set
-- (submitted|completed|backend-error|failed|gone). A vocabulary that differs by door would make the
-- hosted/self-host parity claim cosmetic, and would force any cross-door analysis to special-case a
-- door. Do not add a value here that cf does not have; take it to both doors together (cf#286).
--
-- WHY IT EXISTS. RunPod cannot enumerate jobs: the surface is /run, /status, /stream, /cancel, /retry,
-- /purge-queue, /health, and /status is BY ID ONLY. A job id we do not keep is unreachable permanently,
-- so an operator whose finish jobs are failing has no way to find out what failed. RunPod is opt-in on
-- this door, but an operator who opts in hits the same wall the hosted door did.
--
-- THE WRITER IS DIFFERENT HERE, and this is the one real divergence from cf. On cf each module Worker
-- holds its own D1 binding and writes its own row. On this door NO module can: compose declares 25
-- module services, 9 mount studio-data READ-ONLY, the RunPod submitters mount nothing at all, and the
-- only read-write mount of studio-data belongs to the studio service itself. Giving every module write
-- access to the studio database in order to deliver telemetry would be a worse defect than the
-- blindness it closes, so the STUDIO writes the row, at the one seam every module call passes through
-- (createModuleTransport). A missing module-side write on this door is by design, not a bug.
--
-- OUTCOME VOCABULARY (updated local#304): the closed set is submitted|completed|backend-error|failed|
-- gone|cancelled, matching cf. The module poll carries a structured `outcome` on the envelope
-- (alongside jobId / errorType / runpodStatus); the studio transport records that field.
--
-- HISTORICAL (pre-#304): gone and backend-error were collapsed into {ok:false, error: prose} at the
-- module poll, so those two values were unreachable on this door even though the column could hold
-- them. That destroy-at-the-envelope defect is what #304 fixed. Rows written before the fix may still
-- show undifferentiated `failed` for what would now be gone or backend-error.
--
-- READ THIS BEFORE COMPUTING A RATE on mixed-age data: pre-#304 absence of backend-error/gone means
-- CANNOT EXPRESS for that era, never DID NOT HAPPEN.
--
-- CONTENT-FREE by construction: a vendor job id, a module label derived from the binding name, an
-- outcome from a closed set, a bounded error string, two timestamps. No prompts, no filenames, no user
-- content. The RunPod ENDPOINT id is deliberately NOT a column, matching cf: it arrives as a secret and
-- is reported as a boolean, never as a value.
--
-- Additive (CREATE TABLE + CREATE INDEX only), so it rides the normal auto-apply.
CREATE TABLE IF NOT EXISTS runpod_job_log (
  job_id       TEXT PRIMARY KEY,               -- RunPod job id; the upsert key
  module       TEXT NOT NULL,                  -- module label, derived from the MODULE_*_URL binding
  outcome      TEXT NOT NULL,                  -- submitted|completed|backend-error|failed|gone
  detail       TEXT,                           -- bounded error text; NULL unless a fault
  submitted_at INTEGER,                        -- unix seconds; NULL when the submit time is unknown
                                               -- (never a fabricated value)
  terminal_at  INTEGER                         -- unix seconds; NULL while outcome is submitted
);

-- Group by module over a recent window: the same query shape cf#277 asked for.
CREATE INDEX IF NOT EXISTS idx_runpod_job_log_module_submitted
  ON runpod_job_log (module, submitted_at);
