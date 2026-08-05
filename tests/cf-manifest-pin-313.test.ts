// local#313: manifest-drift must not float on vivijure-cf main for PR CI.
// Pin file + workflow ref is the deliberate contract; this test fails if either half
// is removed or rewritten to track floating main. Also asserts that deliberate local
// divergences carry an in-file marker the sync script honors.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function pinSha(): string {
  const raw = readFileSync(resolve(root, "dev/cf-manifest-pin"), "utf8");
  const m = raw.match(/^SHA=([0-9a-f]{40})\s*$/m);
  if (!m) throw new Error("dev/cf-manifest-pin missing SHA=<40-char hex>");
  return m[1];
}

function localDivergenceFiles(): string[] {
  const dir = resolve(root, "dev/manifests");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as {
        _local_divergence?: unknown;
      };
      return j._local_divergence === "do-not-sync" || j._local_divergence === true;
    })
    .sort();
}

describe("vivijure-cf manifest pin (local#313)", () => {
  it("dev/cf-manifest-pin holds a full 40-char commit SHA", () => {
    const sha = pinSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const body = readFileSync(resolve(root, "dev/cf-manifest-pin"), "utf8");
    expect(body).toMatch(/local#313/);
    expect(body).toMatch(/manifest-drift/);
  });

  it("manifest-drift.yml checks out vivijure-cf at the pin, not floating main", () => {
    const yml = readFileSync(resolve(root, ".github/workflows/manifest-drift.yml"), "utf8");
    expect(yml).toContain("local#313");
    expect(yml).toContain("dev/cf-manifest-pin");
    expect(yml).toContain("steps.cf_pin.outputs.sha");
    // Must not hardcode ref: main on the cf checkout.
    expect(yml).toMatch(/ref:\s*\$\{\{\s*steps\.cf_pin\.outputs\.sha\s*\}\}/);
    expect(yml).not.toMatch(/ref:\s*main\b/);
  });

  it("plan-enhance.json is marked do-not-sync so regenerate cannot wipe Ollama fixture", () => {
    const j = JSON.parse(
      readFileSync(resolve(root, "dev/manifests/plan-enhance.json"), "utf8"),
    ) as { _local_divergence?: unknown; name?: string };
    expect(j.name).toBe("plan-enhance");
    expect(j._local_divergence).toBe("do-not-sync");
  });

  it("at least plan-enhance and bare-planner carry the in-file divergence marker", () => {
    const marked = localDivergenceFiles();
    expect(marked).toContain("plan-enhance.json");
    expect(marked).toContain("bare-planner.json");
  });

  it("sync-module-manifests.ts honors the marker and check script discovers it", () => {
    const sync = readFileSync(resolve(root, "scripts/sync-module-manifests.ts"), "utf8");
    expect(sync).toMatch(/_local_divergence/);
    expect(sync).toMatch(/do-not-sync/);
    expect(sync).toMatch(/isLocalDivergenceFile/);

    const check = readFileSync(resolve(root, "scripts/check-module-manifest-drift.sh"), "utf8");
    expect(check).toMatch(/_local_divergence/);
    expect(check).toMatch(/do-not-sync/);
    expect(check).toMatch(/refresh pin/);
    expect(check).toMatch(/local#313/);
  });
});
