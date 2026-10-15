#!/usr/bin/env tsx
// REPORT where the .env seed and the live platform runtime store disagree (local#379).
//
// `.env` is a seed; `platform_secrets` is the live value and it WINS. An operator who edits the
// documented file and restarts gets the old behaviour with no error. This script is the missing signal.
// It reports and NEVER reconciles: copying either side onto the other would silently destroy a real
// change. It prints key NAMES only, never values.
//
//   npm run check:secret-drift
//
// Exit 1 when any catalogued key holds DIFFERENT values in .env and the store, which is exactly the
// state where an operator edit has no effect. Store-only keys are reported but do not fail the run:
// they are the normal shape of a GUI-configured install, so failing on them would make the check unable
// to ever be green, which is its own defect.

import "dotenv/config";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlatformSecrets } from "../src/platform-secrets-db.js";
import { divergentRows, formatSeedStoreDrift, seedStoreDrift } from "../src/platform-secrets-drift.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);
const store = await listPlatformSecrets(db);

const rows = seedStoreDrift(process.env, store);
for (const line of formatSeedStoreDrift(rows)) console.log(line);

const divergent = divergentRows(rows);
if (divergent.length > 0) {
  console.error(`\n${divergent.length} key(s) diverge between .env and the runtime store (see above).`);
  process.exit(1);
}
