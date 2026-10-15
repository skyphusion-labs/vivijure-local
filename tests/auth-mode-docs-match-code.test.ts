// The docs audit corrected two auth tables and left the two headings ABOVE them saying the
// opposite. docs/SECURITY.md's heading read "Auth mode: token only (v1)" six lines above the
// row it had just changed to `demo | Yes`, and docs/DEPLOYMENT.md's AUTH_MODE row read "Only
// supported mode in v1" three rows above another row the same PR edited. Each line was
// plausible read alone, which is why a self-contradicting document survives review: nobody
// reads a file end to end, they read the heading or they read the table.
//
// This derives the supported set FROM src/auth-gate.ts rather than transcribing it. A test
// that carried its own copy of the mode list would be a self-consistency check: the code
// could change and this would stay green forever, which is the defect it exists to catch,
// one level up.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");

const GATE = "src/auth-gate.ts";

/** Modes the gate DISPATCHES on, read off the source. */
function dispatchedModes(src: string): string[] {
  return [...src.matchAll(/mode === "([a-z]+)"/g)].map((m) => m[1]).sort();
}

/** Modes the gate's own fail-closed message names as expected. */
function advertisedModes(src: string): string[] {
  // The source carries LITERAL double quotes inside a template literal, not escaped ones.
  const m = src.match(/\(expected ([^)]+)\)/);
  if (!m) throw new Error("could not find the fail-closed 'expected ...' message in " + GATE);
  const modes = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
  // A derivation that silently returns nothing is what makes every consumer below pass
  // vacuously. Refuse here instead, so the failure lands on the extractor.
  if (modes.length === 0) throw new Error("advertisedModes extracted nothing from: " + m[1]);
  return modes;
}

describe("auth mode docs agree with auth-gate.ts (not with each other)", () => {
  it("CONTROL: both derivations find modes, and they agree with each other", () => {
    const src = read(GATE);
    const dispatched = dispatchedModes(src);
    const advertised = advertisedModes(src);
    // Denominators beside the claim. A zero from either would make everything below vacuous.
    expect(dispatched.length, `dispatched=${JSON.stringify(dispatched)}`).toBeGreaterThan(1);
    expect(advertised.length, `advertised=${JSON.stringify(advertised)}`).toBeGreaterThan(1);
    // `access` is dispatched only to be REFUSED by name, so it is dispatched and not advertised.
    expect(dispatched, "the gate should still name access explicitly to refuse it").toContain("access");
    expect(advertised, `the gate advertises: ${JSON.stringify(advertised)}`).toEqual(["demo", "token"]);
  });

  it("no document claims a single supported mode", () => {
    // The class, not the two instances that were reported.
    const docs = ["docs/SECURITY.md", "docs/DEPLOYMENT.md", "docs/ARCHITECTURE.md", "USE.md", "docs/quickstart.md"];
    const offenders: string[] = [];
    for (const d of docs) {
      let body: string;
      try {
        body = read(d);
      } catch {
        continue; // a doc that moved is not this guard's business
      }
      for (const line of body.split("\n")) {
        if (/only supported mode|token only|Only supported|only mode/i.test(line)) {
          offenders.push(`${d}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, `a heading or row still claims one mode:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("SECURITY.md's mode table lists every advertised mode as supported", () => {
    const src = read(GATE);
    const advertised = advertisedModes(src);
    // Denominator FIRST: this test LOOPS over `advertised`, so an empty derivation would make
    // its body never run and the test pass having asserted nothing.
    expect(advertised.length, `advertised=${JSON.stringify(advertised)}`).toBeGreaterThan(1);
    const sec = read("docs/SECURITY.md");
    const rows = sec.split("\n").filter((l) => /^\|\s*`(token|demo|access)`\s*\|/.test(l));
    // Control: the table exists at all.
    expect(rows.length, "no auth-mode table rows found; did the table move?").toBeGreaterThanOrEqual(3);
    for (const mode of advertised) {
      const row = rows.find((r) => r.includes(`\`${mode}\``));
      expect(row, `no row for advertised mode ${mode}`).toBeDefined();
      expect(
        row,
        `${mode} is advertised by the gate but its row does not say it is supported: ${row}`,
      ).toMatch(/\|\s*(\*\*)?Yes/i);
    }
    // And the mode the gate refuses by name must NOT read as supported.
    const accessRow = rows.find((r) => r.includes("`access`"));
    expect(accessRow, "no access row").toBeDefined();
    expect(accessRow, `access is refused by name in the gate: ${accessRow}`).toMatch(/\|\s*No\b/);
  });

  it("DEPLOYMENT.md's AUTH_MODE row does not contradict the gate", () => {
    const dep = read("docs/DEPLOYMENT.md");
    const row = dep.split("\n").find((l) => /^\|\s*`AUTH_MODE`\s*\|/.test(l));
    expect(row, "no AUTH_MODE row found in DEPLOYMENT.md").toBeDefined();
    const advertised = advertisedModes(read(GATE));
    // Same reason as above: an empty list would make the loop below assert nothing.
    expect(advertised.length, `advertised=${JSON.stringify(advertised)}`).toBeGreaterThan(1);
    for (const mode of advertised) {
      expect(row, `AUTH_MODE row omits the advertised mode ${mode}: ${row}`).toContain(mode);
    }
  });
});
