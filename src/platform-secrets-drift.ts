// `.env` IS A SEED; THE PLATFORM RUNTIME STORE IS THE LIVE VALUE (local#379).
//
// `RuntimeEnv` merges `process.env` with the `platform_secrets` table and the DB WINS for every key it
// holds. So an operator can edit the documented file, restart, and get the old behaviour with no error
// and no warning: the edit is indistinguishable from the edit being wrong. That is the defect this
// module exists to make observable.
//
// IT REPORTS. IT DOES NOT RECONCILE. Silently copying one side onto the other would destroy either an
// intentional runtime change (store -> seed) or an intentional seed edit (seed -> store), and the
// operator would again have no way to tell which happened. The correct order when the two disagree is
// the operator's to choose, and it is documented in docs/PLATFORM.md: clear the STORE first, then align
// the seed. Seed-first accomplishes nothing at all, because the next sync upserts the seed value back.
//
// NO VALUE EVER LEAVES THIS MODULE. Rows carry presence and an agree/differ verdict, never a value and
// never a hash of one. Comparison happens in memory; the output names keys only. A report about secrets
// that prints secrets is a worse defect than the one it reports.

import {
  PLATFORM_MODULE_URL_COMPOSE_DEFAULTS,
  PLATFORM_MODULE_URL_PURGEABLE_KEYS,
  PLATFORM_SECRET_DERIVED_KEYS,
  PLATFORM_SECRET_FIELDS,
} from "./platform-secrets-catalog.js";
import { PLATFORM_TUNNEL_SYNC_KEYS } from "./platform-secrets-sync.js";

/**
 * Which sync family a key belongs to. mackaye measured on local#379 that this is a property of the
 * FAMILY and not of the sync as a whole, and that nothing surfaced which family a key was in. A key
 * that cannot be unset from the seed is not a slow path to unsetting it; it is not a path at all.
 */
export type SeedSyncFamily =
  /** upserted when set in .env, SKIPPED when empty: the seed can never unset it. */
  | "skip-on-empty"
  /** upserted when set, DELETED from the store when empty: the seed can unset it. */
  | "purge-on-empty"
  /** purged from the store unconditionally: env is the only authority (local#281). */
  | "derived"
  /** catalogued but in no sync list: a .env value for it never reaches the store at all. */
  | "not-synced";

export type SeedStoreStatus =
  /** both sides hold the same value: nothing to report. */
  | "agree"
  /** both sides hold a value and they DIFFER: the store wins, so the seed edit has no effect. */
  | "differ"
  /** only the seed holds a value: env wins at runtime, so the seed is live. */
  | "seed-only"
  /** only the store holds a value: normal on a GUI-configured install, AND the shape an operator sees
   *  after deleting the line from .env on a skip-on-empty key, where deleting it does nothing. */
  | "store-only"
  /** neither side holds a value. */
  | "absent";

export interface SeedStoreRow {
  key: string;
  family: SeedSyncFamily;
  /** presence only, never the value */
  seedSet: boolean;
  storeSet: boolean;
  status: SeedStoreStatus;
  /** which source RuntimeEnv would serve this key from right now */
  winner: "database" | "env" | "unset";
  /** true when editing .env alone can never clear this key from the store */
  seedCannotUnset: boolean;
}

export function seedSyncFamily(key: string): SeedSyncFamily {
  if (PLATFORM_SECRET_DERIVED_KEYS.includes(key)) return "derived";
  if (PLATFORM_MODULE_URL_PURGEABLE_KEYS.includes(key)) return "purge-on-empty";
  if ((PLATFORM_TUNNEL_SYNC_KEYS as readonly string[]).includes(key)) return "skip-on-empty";
  if ((PLATFORM_MODULE_URL_COMPOSE_DEFAULTS as readonly string[]).includes(key)) return "skip-on-empty";
  return "not-synced";
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Compare the seed against the live store for every catalogued key.
 *
 * `env` is the seed as the process sees it (dotenv has already loaded `.env` into it by the time any
 * entry point calls this); `store` is the `platform_secrets` map exactly as `listPlatformSecrets`
 * returns it. Keys absent from both sides are still returned so callers can print a denominator: a
 * report with no denominator cannot distinguish "nothing diverged" from "nothing was examined".
 */
export function seedStoreDrift(
  env: NodeJS.ProcessEnv,
  store: Map<string, string>,
): SeedStoreRow[] {
  const rows: SeedStoreRow[] = [];
  for (const field of PLATFORM_SECRET_FIELDS) {
    const key = field.key;
    const seed = trimmed(env[key]);
    const stored = trimmed(store.get(key));
    const seedSet = seed !== "";
    const storeSet = stored !== "";
    let status: SeedStoreStatus;
    if (seedSet && storeSet) status = seed === stored ? "agree" : "differ";
    else if (seedSet) status = "seed-only";
    else if (storeSet) status = "store-only";
    else status = "absent";
    const family = seedSyncFamily(key);
    rows.push({
      key,
      family,
      seedSet,
      storeSet,
      status,
      // RuntimeEnv: the DB row wins whenever one exists, even an empty one.
      winner: store.has(key) ? "database" : seedSet ? "env" : "unset",
      seedCannotUnset: family === "skip-on-empty" || family === "not-synced",
    });
  }
  return rows;
}

/** The rows that mean an operator edit silently had no effect. This is the gate condition. */
export function divergentRows(rows: SeedStoreRow[]): SeedStoreRow[] {
  return rows.filter((r) => r.status === "differ");
}

/**
 * Human report, names only.
 *
 * Deliberately prints the denominator and the store-only rows even when nothing diverged, because the
 * reassuring reading and the "nothing was examined" reading otherwise render identically.
 */
export function formatSeedStoreDrift(rows: SeedStoreRow[]): string[] {
  const out: string[] = [];
  const differ = divergentRows(rows);
  const storeOnly = rows.filter((r) => r.status === "store-only");
  const seedOnly = rows.filter((r) => r.status === "seed-only");
  const agree = rows.filter((r) => r.status === "agree");

  out.push(
    `seed/store report: ${rows.length} catalogued keys examined -- ` +
      `${differ.length} DIVERGENT, ${agree.length} agree, ${seedOnly.length} seed-only (env is live), ` +
      `${storeOnly.length} store-only, ${rows.length - differ.length - agree.length - seedOnly.length - storeOnly.length} unset on both sides`,
  );

  if (differ.length > 0) {
    out.push("");
    out.push("DIVERGENT -- .env and the runtime store hold DIFFERENT values. The store wins, so the");
    out.push(".env value is not in effect and restarting will not change that:");
    for (const r of differ) {
      out.push(`  ${r.key} (family ${r.family}; runtime serves the store)`);
    }
    out.push("");
    out.push("To make a .env value win, clear the STORE row first, then align .env:");
    out.push("  PATCH /api/settings/secrets with an empty value (check the `cleared` array in the");
    out.push("  response: a 200 with an empty `cleared` means the call did nothing), THEN edit .env.");
    out.push("  Seed-first accomplishes nothing: the next sync:secrets upserts the seed value back.");
  }

  const unsettable = storeOnly.filter((r) => r.seedCannotUnset);
  if (unsettable.length > 0) {
    out.push("");
    out.push("STORE-ONLY on a key the seed CANNOT unset. Normal on a GUI-configured install, but");
    out.push("deleting the line from .env and restarting will NOT clear these; sync skips empties:");
    for (const r of unsettable) {
      out.push(`  ${r.key} (family ${r.family})`);
    }
  }

  return out;
}
