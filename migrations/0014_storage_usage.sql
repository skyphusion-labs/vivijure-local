-- Per-object storage accounting ledger (core#52, the R2_STORAGE_QUOTA_BYTES operator knob).
--
-- vivijure-cf twin: migrations/0013_storage_usage.sql. Same schema, same accounting, same release wave;
-- the knob lives in @skyphusion-labs/vivijure-core so the Workers door and this Node door behave
-- identically, and neither host reads a bucket-usage API (that read is Cloudflare-specific and would
-- break MinIO/S3 here, which is a parity break for a parity feature).
--
-- One row per object in the renders store. The studio upserts a row on every write and drops it on every
-- delete, through the metering wrapper applied where the platform storage is built
-- (src/server.ts + src/platform/reload.ts). The quota check SUMs this table at submit.
--
-- KEYED ON THE OBJECT KEY, not a running total: the film/clip job docs are re-written to the SAME key on
-- every advance tick, so an add-bytes-on-put counter would climb on control docs alone and wedge a
-- long-lived studio at its own ceiling. A rewrite UPDATES one row.
--
-- Accounting starts at the version that ships this: existing artifacts are not in the ledger, because
-- artifact SIZES are not derivable from the studio DB. POST /api/storage/reconcile rebuilds the ledger
-- from the store itself and is the one-time backfill as well as the drift repair.
--
-- The DDL below is STORAGE_USAGE_DDL from vivijure-core, verbatim; tests/storage-quota-wiring.test.ts
-- fails if this file drifts from it.
CREATE TABLE IF NOT EXISTS storage_usage (
  object_key TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
