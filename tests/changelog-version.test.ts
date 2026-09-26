// REVIEW-TIME version agreement for vivijure-local (local#399).
//
// WHY THIS EXISTS, AND WHAT WAS ALREADY HERE
//
// This repo already had a RELEASE-time guard: build-image.yml, step "Tag matches the declared
// version", refuses to publish when a pushed `v*` tag does not equal `package.json` version, or
// when CHANGELOG.md carries no `## v<version>` line. That is the last possible moment. The
// mislabelled commit is already reviewed and merged, the person who hits the failure is whoever
// cuts the tag rather than whoever wrote the commit, and it never fires at all on a release nobody
// attempts, so `main` can carry a version that disagrees with its own CHANGELOG indefinitely and
// nothing says so.
//
// Three things that guard cannot see, and this file covers all three:
//
//  1. It runs at tag time only. This runs inside the required `ci` check on every PR, which is the
//     moment a human is already looking at the diff.
//  2. It asserts `grep -qF "## v<version>"`, i.e. that the heading exists ANYWHERE in the file. A
//     stale `package.json` whose old heading is still present three releases down the page passes
//     that. This asserts the version equals the NEWEST `## vX.Y.Z` heading.
//  3. It never reads package-lock.json, which is a THIRD and FOURTH copy of this repo's own
//     version (`version` and `packages[""].version`). Bumping package.json by hand does not
//     regenerate the lock, and that exact drift has bitten vivijure-cf twice: most recently on the
//     cf v1.26.0 release PR, where package.json moved to 1.26.0 and package-lock.json stayed at
//     1.25.0.
//
// PARITY, NOT A BLIND PORT (local#399)
//
// vivijure-cf carries tests/changelog-version.test.ts for the same reason. The estate rule is
// absolute hosted / self-host parity, and nothing about being the local panel makes a version
// drift less likely or less harmful here. But the two repos do not share a changelog convention,
// so the cf file is adapted rather than copied:
//
//   cf    : the top `##` heading IS the last released version.
//   local : CHANGELOG.md opens with a `## Unreleased` section that accumulates work which
//           explicitly "does not cut a studio tag", and the newest `## vX.Y.Z` heading sits BELOW
//           it. Measured on main b48da47e: `## Unreleased` at line 8, `## v1.10.0 -- 2026-08-16`
//           at line 38, package.json 1.10.0.
//
// So the parser must SKIP `## Unreleased` and read the newest version-shaped heading, and there is
// a control below that plants exactly that layout. The documented convention this asserts is
// CLAUDE.md "Cut a release": "Release PR: bump package.json, add CHANGELOG.md `## vX.Y.Z`, land
// the PR" -- both in the same PR, which is what makes equality the right assertion rather than
// something looser.
//
// NO EARLY RETURN. vivijure-core's equivalent guard was green on its own PR head because it
// returned before reaching the assertion (`if (!claim.unreleased) return;`), so green CI was
// evidence that the guard had not run. Every assertion here runs unconditionally against the real
// files, and every parser returns null rather than a partial result on anything malformed, so a
// broken parse fails the assertion instead of comparing undefined against undefined and passing.
//
// CONTROLS ARE POSITIVE, not hypothetical: each planted fixture below is run through the SAME
// predicate the real assertion uses, so a comparison that had degenerated into a vacuous pass
// would show up here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

/** The newest "## vX.Y.Z" heading. `## Unreleased` and any other non-version `##` heading is
 *  skipped because it does not match the version shape. Headings may carry a trailing
 *  " -- <date>"; only the version is read. Returns null when the changelog has no heading in that
 *  shape at all, so a broken parse is a failure rather than a silent pass against an empty
 *  string. */
export function topChangelogVersion(changelog: string): string | null {
  const m = /^##\s+v(\d+\.\d+\.\d+)\b/m.exec(changelog);
  return m ? m[1] : null;
}

/** True when the changelog carries an `## Unreleased` section above the newest version heading.
 *  Not an assertion on its own; it is reported in the agreement test so a green says which layout
 *  it actually compared, rather than leaving that to be assumed. */
export function hasUnreleasedSection(changelog: string): boolean {
  const unreleased = /^##\s+Unreleased\s*$/m.exec(changelog);
  if (!unreleased) return false;
  const version = /^##\s+v\d+\.\d+\.\d+\b/m.exec(changelog);
  if (!version) return true;
  return unreleased.index < version.index;
}

/** The two places package-lock.json declares THIS package's own version: the top-level "version"
 *  field, and packages[""].version (the root package entry, lockfileVersion 3 shape). Returns null
 *  on anything malformed or missing rather than a partial result. */
export function lockFileVersions(lockJson: string): { top: string; root: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const packages = obj.packages;
  if (typeof obj.version !== "string" || typeof packages !== "object" || packages === null) {
    return null;
  }
  const rootEntry = (packages as Record<string, unknown>)[""];
  if (typeof rootEntry !== "object" || rootEntry === null) return null;
  const rootVersion = (rootEntry as Record<string, unknown>).version;
  if (typeof rootVersion !== "string") return null;
  return { top: obj.version, root: rootVersion };
}

/** An EXACT pin is a dependency range with no operator at all ("1.22.5"). Caret and tilde ranges
 *  deliberately admit newer releases, so the lock resolving something newer than the floor is npm
 *  working as designed, not drift, and this returns null for them. Only an exact pin carries the
 *  promise "this is the version that installs", which is the promise a stale lock breaks. */
export function exactPin(range: string): string | null {
  return /^\d+\.\d+\.\d+$/.test(range.trim()) ? range.trim() : null;
}

describe("package.json version agrees with CHANGELOG.md (local#399)", () => {
  it("equals the newest `## vX.Y.Z` heading, and reports which layout it compared", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
    const top = topChangelogVersion(changelog);
    expect(top, "CHANGELOG.md has no `## vX.Y.Z` heading to compare against").not.toBeNull();
    expect(typeof pkg.version).toBe("string");
    expect(
      pkg.version,
      `package.json declares ${pkg.version} but the newest CHANGELOG heading is v${top} ` +
        `(Unreleased section above it: ${hasUnreleasedSection(changelog)}); ` +
        `per CLAUDE.md "Cut a release", the bump and the \`## vX.Y.Z\` heading land in the SAME PR, ` +
        `so bump whichever one lagged`,
    ).toBe(top);
  });

  it("CONTROL: the parser skips `## Unreleased` and reads the newest version heading below it", () => {
    // This is vivijure-local's actual layout and the one difference from vivijure-cf, so it is
    // asserted rather than assumed.
    const planted =
      "# Changelog\n\n## Unreleased\n\n### chore(deps): pin core\n\nnotes\n\n" +
      "## v1.10.0 -- 2026-08-16\n\nnotes\n\n## v1.9.0 -- 2026-08-07\n\nnotes\n";
    expect(topChangelogVersion(planted)).toBe("1.10.0");
    expect(hasUnreleasedSection(planted)).toBe(true);
  });

  it("CONTROL: a heading with no trailing date reads the same", () => {
    expect(topChangelogVersion("# Changelog\n\n## v2.4.1\n\nnotes\n")).toBe("2.4.1");
  });

  it("CONTROL: a changelog with no version heading at all returns null rather than a pass", () => {
    expect(topChangelogVersion("# Changelog\n\n## Unreleased\n\nnotes\n")).toBeNull();
  });

  it("CONTROL: a planted mismatch is what this test exists to catch", () => {
    // Same predicate the real assertion runs, over a fixture instead of the real files. If the
    // detector below ever answered true here, the comparison would have degenerated into a
    // vacuous pass.
    const pkgVersion = "1.9.0";
    const changelog = "# Changelog\n\n## Unreleased\n\n## v1.10.0\n\nnotes\n";
    expect(pkgVersion === topChangelogVersion(changelog)).toBe(false);
  });
});

describe("package-lock.json agrees with package.json (local#399: two more copies, read by nothing until now)", () => {
  it("both the top-level version and packages[\"\"].version match package.json", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const lockRaw = readFileSync(join(repoRoot, "package-lock.json"), "utf8");
    const lock = lockFileVersions(lockRaw);
    expect(
      lock,
      "package-lock.json is missing or malformed at the fields this check reads",
    ).not.toBeNull();
    expect(
      lock?.top,
      `package-lock.json top-level version is ${lock?.top} but package.json declares ` +
        `${pkg.version}; run npm install to refresh the lock`,
    ).toBe(pkg.version);
    expect(
      lock?.root,
      `package-lock.json packages[""].version is ${lock?.root} but package.json declares ` +
        `${pkg.version}; run npm install to refresh the lock`,
    ).toBe(pkg.version);
  });

  it("CONTROL: the parser reads a planted lock with both fields present", () => {
    const planted = JSON.stringify({ version: "2.4.1", packages: { "": { version: "2.4.1" } } });
    expect(lockFileVersions(planted)).toEqual({ top: "2.4.1", root: "2.4.1" });
  });

  it("CONTROL: a planted mismatch on the top-level field is caught", () => {
    const planted = JSON.stringify({ version: "1.9.0", packages: { "": { version: "1.10.0" } } });
    expect(lockFileVersions(planted)?.top === "1.10.0").toBe(false);
  });

  it("CONTROL: a planted mismatch on packages[\"\"].version is caught", () => {
    // The shape cf#273 shipped undetected: package.json and the lock top-level both corrected,
    // the root package entry left stale.
    const planted = JSON.stringify({ version: "1.10.0", packages: { "": { version: "1.9.0" } } });
    expect(lockFileVersions(planted)?.root === "1.10.0").toBe(false);
  });

  it("CONTROL: malformed JSON and a missing root package entry both fail closed, not open", () => {
    expect(lockFileVersions("not json")).toBeNull();
    expect(lockFileVersions(JSON.stringify({ version: "1.0.0", packages: {} }))).toBeNull();
  });
});

describe("an EXACT core / MCP pin is what actually installs (local#399)", () => {
  // `npm ci` installs what the LOCK resolves, not what the range admits. An exact pin in
  // package.json is a promise about the installed version, and editing that pin by hand without
  // refreshing the lock silently keeps the whole panel on the older package. Measured on main
  // b48da47e: @skyphusion-labs/vivijure-core is pinned exactly at 1.22.5 and the lock resolves
  // 1.22.5; @skyphusion-labs/vivijure-mcp is ^1.3.0 and the lock resolves 1.3.0.
  //
  // Caret and tilde ranges are deliberately NOT asserted to equal their floor. A lock resolving a
  // newer patch under a caret is npm working as designed, and asserting equality there would red
  // PRs for a reason that has nothing to do with the PR.
  it("every @skyphusion-labs dependency has a lock entry, and exact pins match it", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
    const declared: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const names = Object.keys(declared).filter((n) => n.startsWith("@skyphusion-labs/"));
    expect(
      names.length,
      "no @skyphusion-labs dependency found in package.json; this check would be vacuous",
    ).toBeGreaterThan(0);
    for (const name of names) {
      const entry = lock.packages?.[`node_modules/${name}`];
      expect(
        entry?.version,
        `package-lock.json has no resolved version for ${name}; npm ci installs from the lock, ` +
          `so a declared dependency missing there is not installed at all`,
      ).toBeTypeOf("string");
      const pin = exactPin(declared[name]);
      if (pin !== null) {
        expect(
          entry.version,
          `package.json pins ${name} exactly at ${pin} but package-lock.json resolves ` +
            `${entry.version}; npm ci installs the LOCK, so the pin is not what runs. ` +
            `Run npm install to refresh the lock`,
        ).toBe(pin);
      }
    }
  });

  it("CONTROL: exactPin accepts a bare version and rejects every range form", () => {
    expect(exactPin("1.22.5")).toBe("1.22.5");
    expect(exactPin("^1.3.0")).toBeNull();
    expect(exactPin("~1.3.0")).toBeNull();
    expect(exactPin(">=1.3.0")).toBeNull();
    expect(exactPin("1.x")).toBeNull();
  });

  it("CONTROL: an exact pin disagreeing with the lock is caught, and a caret is not flagged", () => {
    const exact = exactPin("1.22.5");
    expect(exact !== null && exact === "1.22.4").toBe(false);
    expect(exactPin("^1.22.5")).toBeNull();
  });
});
