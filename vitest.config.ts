import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    // The vitest default (5000ms) sits close to the real cost of the module-discovery /
    // sqlite-migration tests (measured 2026-08-01, local#282): 23 test files spin up a fresh
    // SQLite db + real migrations per test, and the slowest of those (demo-routes.test.ts,
    // seeding ~38KB of demo fixture SQL) baselines at ~2.4s even on an idle box, with most
    // migration-backed tests in the 500-800ms band. The CI incident that filed this issue saw the
    // whole test PHASE take 59s instead of its usual ~5s (an ~11.8x slowdown from runner load);
    // applied to the slowest measured single test, that is ~28s. 30s keeps a real margin above
    // that without hiding a genuine hang -- a truly stuck test still fails, just at 30s instead of
    // 5s, and every fast unit test in the suite (the overwhelming majority, sub-1ms) is unaffected
    // either way.
    testTimeout: 30000,
    server: {
      deps: {
        // npm-installed core uses internal relative imports; inline so vi.mock on
        // @skyphusion-labs/vivijure-core/* applies inside cast-lora-train etc.
        inline: ["@skyphusion-labs/vivijure-core"],
      },
    },
  },
});
