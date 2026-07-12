#!/usr/bin/env tsx
/**
 * M8 parity gate: run install-time live conformance against compose module sidecars.
 *
 *   docker compose up -d
 *   npm run conformance:sidecars
 *
 * Reads MODULE_*_URL from the environment (compose studio + dev/module-fleet.env).
 * Exits non-zero when any sidecar fails runLiveConformance.
 */
import { HttpFetcher } from "../src/platform/http-fetcher.js";
import { allPass, failures, runLiveConformance } from "../src/modules/conformance.js";

const MODULE_URL_RE = /^MODULE_[A-Z0-9_]+_URL$/;

function moduleUrlsFromEnv(env: NodeJS.ProcessEnv): Array<{ label: string; url: string }> {
  const rows: Array<{ label: string; url: string }> = [];
  for (const [key, raw] of Object.entries(env)) {
    if (!MODULE_URL_RE.test(key)) continue;
    const url = raw?.trim().replace(/\/$/, "");
    if (!url) continue;
    const label = key.replace(/^MODULE_/, "").replace(/_URL$/, "").toLowerCase().replace(/_/g, "-");
    rows.push({ label, url });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

function fail(msg: string): never {
  console.error(`conformance: FAIL -- ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const modules = moduleUrlsFromEnv(process.env);
  if (!modules.length) {
    fail("no MODULE_*_URL bindings in env (start compose or source dev/module-fleet.env)");
  }

  let failed = 0;
  for (const { label, url } of modules) {
    const fetcher = new HttpFetcher(url);
    const checks = await runLiveConformance({
      fetch: (input, init) => fetcher.fetch(input, init),
    });
    if (allPass(checks)) {
      console.log(`conformance: PASS ${label} (${url})`);
      continue;
    }
    failed++;
    console.error(`conformance: FAIL ${label} (${url})`);
    for (const c of failures(checks)) {
      console.error(`  - ${c.name}: ${c.detail}`);
    }
  }

  if (failed) fail(`${failed}/${modules.length} sidecar(s) failed live conformance`);
  console.log(`conformance: PASS -- ${modules.length} sidecar(s)`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
