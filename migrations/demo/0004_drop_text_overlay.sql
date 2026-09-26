-- Vivijure Studio -- DEMO STUDIO migration. DEMO DB ONLY. NEVER prod.
--
-- local#400 / cf#24 parity. Removes the retired text-overlay catalog row from a demo DB that
-- already applied 0001 before that row was deleted from it.
--
-- Why a migration and not just the 0001 edit: 0001 is INSERT OR IGNORE and idempotent, so a
-- re-apply is a no-op and never removes anything. Editing 0001 fixes FRESH demo databases only.
-- Any demo DB seeded before this change still holds the row, and the registry reads the ROW, not
-- the file (discoverDispatchModules SELECTs installed_modules WHERE enabled = 1 in demo mode), so
-- the stale panel survives a redeploy of the code. This is the statement that clears it.
--
-- Unlike the cf sibling, this needs no manual wrangler step: scripts/migrate-demo.ts scans
-- migrations/demo/NNNN_*.sql, records what it applied in _demo_migrations, and picks this up on the
-- next `npm run migrate:demo`.
--
-- Safe on a DB that never had the row: DELETE of zero rows is a no-op, so this is idempotent too.

DELETE FROM installed_modules WHERE name = 'text-overlay';
