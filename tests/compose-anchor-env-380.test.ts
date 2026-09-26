// A YAML MERGE KEY DOES NOT DEEP-MERGE MAPPINGS (local#380).
//
// `<<: *runpod-module` at service level plus the service's own `environment:` block does NOT extend the
// anchor's environment, it REPLACES it. Both finish modules read as though a couple of dozen variables
// reached them and exactly one did: measured 1 of 22, with module-keyframe at 22 from the same anchor as
// the positive control that the matcher works. It was latent, not live, because the platform runtime
// store (local#379) supplied the real values -- which is what made it dangerous rather than safe.
//
// THE INSTRUMENT: render the real compose resolver TWICE. Once as the file stands, and once over a copy
// with every service-level `environment:` block deleted. The second render is, by construction, exactly
// what the anchors supply to each service, resolved by compose itself rather than by a regex guess about
// what compose would do. The invariant is then a superset: a service's real environment must contain
// every key its anchors give it. Nothing here is stubbed, and nothing here hardcodes a var count, so a
// var added to an anchor tomorrow is covered without touching this file.
//
// This test FAILS on the merge-key form. That is the point: it was written against the defect and
// observed red on it before the fix landed.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const PROFILES = ["satellites", "cloud", "localgpu"];

/**
 * Compose v2 ships as a `docker` plugin and v5 also ships as a standalone binary; a dev box may have
 * either. Absence is a hard FAILURE and never a skip: a skipped guard is a green that cannot go red.
 */
function composeArgv(): string[] {
  for (const candidate of [["docker", "compose"], ["docker-compose"]]) {
    try {
      execFileSync(candidate[0], [...candidate.slice(1), "version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("no compose CLI found (tried `docker compose` and `docker-compose`); this guard needs the real resolver");
}

const ARGV = composeArgv();

type Rendered = {
  /** env key sets per service */
  keys: Map<string, Set<string>>;
  /** env values per service, so the override half is checkable too */
  values: Map<string, Record<string, string>>;
};

/** Resolved environment, keyed by service, straight out of the compose resolver. */
function render(file: string): Rendered {
  const argv = [...ARGV.slice(1), "--env-file", "/dev/null", "-f", file, "--project-directory", REPO];
  for (const p of PROFILES) argv.push("--profile", p);
  const out = execFileSync(ARGV[0], [...argv, "config", "--format", "json"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const cfg = JSON.parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
  const keys = new Map<string, Set<string>>();
  const values = new Map<string, Record<string, string>>();
  for (const [name, body] of Object.entries(cfg.services)) {
    keys.set(name, new Set(Object.keys(body.environment ?? {})));
    values.set(name, body.environment ?? {});
  }
  return { keys, values };
}

/** Delete every service-level (indent 4) `environment:` block. Returns the text and how many it cut. */
function stripServiceEnv(src: string): { text: string; removed: number } {
  const lines = src.split("\n");
  const out: string[] = [];
  let removed = 0;
  for (let i = 0; i < lines.length; ) {
    if (/^ {4}environment:\s*$/.test(lines[i])) {
      removed += 1;
      i += 1;
      while (i < lines.length && (lines[i].trim() === "" || lines[i].startsWith("      "))) i += 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return { text: out.join("\n"), removed };
}

const source = readFileSync(join(REPO, "compose.yaml"), "utf8");
const { text: strippedText, removed } = stripServiceEnv(source);

const scratch = mkdtempSync(join(tmpdir(), "compose-anchor-env-380-"));
const strippedFile = join(scratch, "compose.anchors-only.yaml");
writeFileSync(strippedFile, strippedText);

let actual: Rendered;
let anchorOnly: Rendered;
try {
  actual = render(join(REPO, "compose.yaml"));
  anchorOnly = render(strippedFile);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** Services that inherit at least one env var from an anchor. This is the denominator. */
const population = [...anchorOnly.keys.entries()]
  .filter(([, keys]) => keys.size > 0)
  .map(([name]) => name)
  .sort();

describe("compose anchors: a service-level environment: block must EXTEND, not replace (local#380)", () => {
  it("the instrument itself cut real environment blocks", () => {
    // If the stripper matched nothing, both renders are identical and every assertion below passes
    // vacuously. This is the control on the control.
    expect(removed).toBeGreaterThanOrEqual(10);
  });

  it("the population is the whole anchor-inheriting fleet, not a hand-picked pair", () => {
    expect(population.length).toBeGreaterThanOrEqual(15);
    for (const svc of ["module-finish-lipsync", "module-finish-upscale", "module-keyframe", "video-finish"]) {
      expect(population, `${svc} must be in the measured population`).toContain(svc);
    }
  });

  it("every anchor env var reaches every service that merges the anchor", () => {
    const violations: string[] = [];
    for (const name of population) {
      const want = anchorOnly.keys.get(name) ?? new Set<string>();
      const have = actual.keys.get(name) ?? new Set<string>();
      const missing = [...want].filter((k) => !have.has(k)).sort();
      if (missing.length > 0) {
        violations.push(
          `${name}: ${missing.length} of ${want.size} anchor env vars do not reach the container ` +
            `(${missing.join(", ")}). A service-level environment: block REPLACES the anchor's; ` +
            `nest <<: *<anchor>-env inside it instead.`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("the finish modules inherit the same anchor env as their siblings AND keep their override", () => {
    // Relational, not a magic number: whatever module-keyframe gets from *runpod-module, the finish
    // modules get too, so adding a var to the anchor never needs an edit here.
    const keyframe = actual.keys.get("module-keyframe") ?? new Set<string>();
    expect(keyframe.size).toBeGreaterThan(1);
    for (const svc of ["module-finish-lipsync", "module-finish-upscale"]) {
      const have = actual.keys.get(svc) ?? new Set<string>();
      const missing = [...keyframe].filter((k) => !have.has(k));
      expect(missing, `${svc} is missing ${missing.join(", ")} that module-keyframe has`).toEqual([]);
      // And the override the service-level block exists FOR must still win. Deleting that block would
      // satisfy the superset check above while losing the satellite worker cap, so assert both halves.
      expect(actual.values.get(svc)?.RUNPOD_WORKERS_MAX, `${svc} must keep its own workersMax override`).toBe("2");
    }
    expect(actual.values.get("module-keyframe")?.RUNPOD_WORKERS_MAX, "the anchor default must be unchanged").toBe("3");
  });
});
