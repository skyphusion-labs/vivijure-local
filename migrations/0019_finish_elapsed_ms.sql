-- renders.finish_elapsed_ms: CPU finish container wall-clock per job (cf#268 / core 1.8.0).
--
-- Capacity planning for owned finish iron. NOT billing, NOT GPU job time (execution_time_ms).
-- Core 1.8.0 sums container elapsedMs and writes this column; SELECT requires it.
-- NULL = not measured. Never coalesce NULL to 0.
--
-- Additive ADD COLUMN only. Dual-panel of vivijure-cf migrations/0017_finish_elapsed_ms.sql
-- (local migration numbers already used 0016/0017 for runpod_job_log).
ALTER TABLE renders ADD COLUMN finish_elapsed_ms INTEGER;
