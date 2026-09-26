// `.env` IS A SEED AND THE RUNTIME STORE IS THE LIVE VALUE (local#379).
//
// The defect: `RuntimeEnv` lets the `platform_secrets` row WIN over `process.env`, so an operator can
// edit the documented file, restart, and get byte-identical old behaviour with no error and no warning.
// Nothing compared the two sides, so there was no reading that could have told them apart.
//
// THE SEAM: the last test here does not stub anything. It builds a real SQLite store, puts a real
// divergence in it, runs the real `scripts/check-secret-drift.ts` in a real child process with a
// hermetic env, and judges the real exit status. The unit tests above it prove the decision path; only
// that one proves the shipped artifact. It also asserts the thing a report about secrets must never do:
// neither value appears anywhere in the output.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";
import { upsertPlatformSecret } from "../src/platform-secrets-db.js";
import {
  divergentRows,
  formatSeedStoreDrift,
  seedStoreDrift,
  seedSyncFamily,
} from "../src/platform-secrets-drift.js";

const REPO = join(import.meta.dirname, "..");

describe("seedStoreDrift: the seed and the store must be comparable (local#379)", () => {
  it("names the divergence when both sides hold a value and they differ", () => {
    const rows = seedStoreDrift(
      { LOCAL_FINISH_LIPSYNC_URL: "http://seed:9110" },
      new Map([["LOCAL_FINISH_LIPSYNC_URL", "http://store:9110"]]),
    );
    const row = rows.find((r) => r.key === "LOCAL_FINISH_LIPSYNC_URL");
    expect(row?.status).toBe("differ");
    expect(row?.winner).toBe("database");
    expect(divergentRows(rows).map((r) => r.key)).toEqual(["LOCAL_FINISH_LIPSYNC_URL"]);
  });

  it("does not cry drift when the two sides agree, and still prints a denominator", () => {
    const rows = seedStoreDrift(
      { LOCAL_FINISH_LIPSYNC_URL: "http://same:9110" },
      new Map([["LOCAL_FINISH_LIPSYNC_URL", "http://same:9110"]]),
    );
    expect(divergentRows(rows)).toEqual([]);
    // The denominator is the control on the report: without it "nothing diverged" and "nothing was
    // examined" render identically.
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(formatSeedStoreDrift(rows)[0]).toContain(`${rows.length} catalogued keys examined`);
  });

  it("distinguishes which side is live when only one holds a value", () => {
    const seedOnly = seedStoreDrift({ CF_AIG_TOKEN: "x" }, new Map());
    expect(seedOnly.find((r) => r.key === "CF_AIG_TOKEN")?.status).toBe("seed-only");
    expect(seedOnly.find((r) => r.key === "CF_AIG_TOKEN")?.winner).toBe("env");

    const storeOnly = seedStoreDrift({}, new Map([["CF_AIG_TOKEN", "y"]]));
    expect(storeOnly.find((r) => r.key === "CF_AIG_TOKEN")?.status).toBe("store-only");
    expect(storeOnly.find((r) => r.key === "CF_AIG_TOKEN")?.winner).toBe("database");
  });

  it("surfaces which sync FAMILY a key is in, because that decides if the seed can unset it", () => {
    // mackaye's measurement on local#379: this is a property of the family, not of the sync. Two
    // families purge on empty and one skips, and nothing surfaced which was which.
    expect(seedSyncFamily("LOCAL_FINISH_LIPSYNC_URL")).toBe("skip-on-empty");
    expect(seedSyncFamily("MODULE_LIPSYNC_URL")).toBe("purge-on-empty");
    expect(seedSyncFamily("MODULE_LOCAL_GPU_URL")).toBe("derived");
    expect(seedSyncFamily("ANTHROPIC_API_KEY")).toBe("not-synced");

    const rows = seedStoreDrift({}, new Map([["LOCAL_FINISH_LIPSYNC_URL", "http://store:9110"]]));
    const row = rows.find((r) => r.key === "LOCAL_FINISH_LIPSYNC_URL");
    expect(row?.seedCannotUnset).toBe(true);
    expect(formatSeedStoreDrift(rows).join("\n")).toContain("the seed CANNOT unset");
  });

  it("reports and never reconciles: the store is untouched by a report", () => {
    const store = new Map([["CF_AIG_TOKEN", "store-value"]]);
    seedStoreDrift({ CF_AIG_TOKEN: "seed-value" }, store);
    formatSeedStoreDrift(seedStoreDrift({ CF_AIG_TOKEN: "seed-value" }, store));
    expect(store.get("CF_AIG_TOKEN")).toBe("store-value");
    expect(store.size).toBe(1);
  });

  it("prints key names and NEVER a value", () => {
    const rows = seedStoreDrift(
      { CF_AIG_TOKEN: "seed-tttttttttt", LOCAL_FINISH_LIPSYNC_URL: "http://seed-uuuuuuuuuu:1" },
      new Map([
        ["CF_AIG_TOKEN", "store-vvvvvvvvvv"],
        ["LOCAL_FINISH_LIPSYNC_URL", "http://store-wwwwwwwwww:1"],
      ]),
    );
    const text = formatSeedStoreDrift(rows).join("\n");
    expect(text).toContain("CF_AIG_TOKEN");
    for (const value of ["seed-tttttttttt", "store-vvvvvvvvvv", "seed-uuuuuuuuuu", "store-wwwwwwwwww"]) {
      expect(text, `a report about secrets must not print ${value.slice(0, 4)}...`).not.toContain(value);
    }
  });
});

describe("check:secret-drift against a real store (local#379)", () => {
  let dir = "";
  let dbPath = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-seed-store-drift-"));
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(REPO, "migrations"));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Hermetic child env. DOTENV_CONFIG_PATH is pinned at /dev/null on purpose: the script imports
   * `dotenv/config`, so a developer's own .env would otherwise decide the result instead of the fixture
   * (the local#275 lesson, same trap the compose tests hit with --env-file).
   */
  function run(extra: Record<string, string>): { status: number; output: string } {
    try {
      const out = execFileSync("npx", ["tsx", "scripts/check-secret-drift.ts"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          DOTENV_CONFIG_PATH: "/dev/null",
          DATABASE_PATH: dbPath,
          ...extra,
        },
      });
      return { status: 0, output: out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("EXITS NON-ZERO and names the key when the seed and the store disagree", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "LOCAL_FINISH_LIPSYNC_URL", "http://store-zzzzzzzz:9110");

    const { status, output } = run({ LOCAL_FINISH_LIPSYNC_URL: "http://seed-yyyyyyyy:9110" });

    expect(status, output).toBe(1);
    expect(output).toContain("LOCAL_FINISH_LIPSYNC_URL");
    expect(output).toContain("DIVERGENT");
    // The store wins, so the operator needs the order, not just the news.
    expect(output).toContain("clear the STORE row first");
    // And the report must not leak either value.
    expect(output).not.toContain("store-zzzzzzzz");
    expect(output).not.toContain("seed-yyyyyyyy");
  }, 60_000);

  it("EXITS ZERO when they agree, so the gate can actually be green", async () => {
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "LOCAL_FINISH_LIPSYNC_URL", "http://same:9110");

    const { status, output } = run({ LOCAL_FINISH_LIPSYNC_URL: "http://same:9110" });

    expect(status, output).toBe(0);
    expect(output).toContain("catalogued keys examined");
    expect(output).not.toContain("DIVERGENT --");
  }, 60_000);

  it("EXITS ZERO on a store-only key, which is the normal GUI-configured install", async () => {
    // A check that reds on every real install gets switched off. Store-only is reported, not failed.
    const db = openDatabase(dbPath);
    await upsertPlatformSecret(db, "CF_AIG_TOKEN", "store-only-value");

    const { status, output } = run({});

    expect(status, output).toBe(0);
    expect(output).toContain("CF_AIG_TOKEN");
    expect(output).toContain("the seed CANNOT unset");
    expect(output).not.toContain("store-only-value");
  }, 60_000);
});
