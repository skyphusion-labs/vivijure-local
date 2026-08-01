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
-- WHAT THIS COLUMN CANNOT SAY ON THIS DOOR, stated in the schema and not only in a runbook, because an
-- absence that is not documented reads as an observation:
--
--   outcome can hold submitted, completed and failed here. It CANNOT hold backend-error or gone.
--
-- Not because those never happen: because this doors module poll collapses every failure into
-- {ok:false, error: <prose>} before it reaches the studio, so the distinction is destroyed at the
-- transport and no column downstream can recover it. Separating them studio-side would mean matching
-- English error sentences, which is a parser only as fresh as its sample. Tracked as its own issue,
-- separate from cf#286: cf TRUNCATES a structured error, this door DESTROYS it, and they need
-- different fixes.
--
-- READ THIS BEFORE COMPUTING A RATE: the absence of backend-error and gone rows on this door means
-- CANNOT EXPRESS, never DID NOT HAPPEN. A failure rate computed from these rows is a rate of
-- everything-that-went-wrong, undifferentiated.
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
