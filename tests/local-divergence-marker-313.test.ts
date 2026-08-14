// local#313, second half. The FIRST half (a cf-side merge reddening this repo's CI) was
// absorbed honestly by #403. This is the other half, and it was still live on main:
//
//   check-module-manifest-drift.sh   EXCLUDE_RE excluded plan-enhance.json from BOTH
//                                    directions of the diff
//   sync-module-manifests.ts         "plan-enhance" sits in the sync INCLUDE list
//
// So the tool that WRITES regenerated the file from cf while the tool that CHECKS was blind
// to it. `npm run module-manifests` replaced local's Ollama first-win fixture with cf's
// Anthropic one and took the version 0.3.1 -> 0.2.1, and no gate could report it. That is
// not a drift bug: it is a guard with a hole cut in exactly the shape of the thing it would
// have caught. #403 confirmed it empirically, watching five files rewritten against four
// reported drifts.
//
// THE TEST RUNS THE REAL SCRIPT AGAINST A REAL TREE. Asserting on the scripts' TEXT would
// pass whether or not the behaviour is right, and the behaviour is the whole claim. The
// protection deliberately engages only when writing the REAL dev/manifests (CI regenerates
// into MANIFESTS_OUT and must still get the cf shape there, or the checker's diff breaks),
// so the temp tree carries its own scripts/ dir: the script derives ROOT from
// import.meta.dirname, which makes a copied script write into the copy.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "..");
let dir = "";

/** A synthetic vivijure-cf whose plan-enhance MANIFEST is deliberately NOT local's.
 *
 *  BOTH entrypoints are written on purpose. The fix prefers `src/manifest.ts` (the cf#285
 *  leaf shape) and falls back to `src/index.ts`; main's version reads only `index.ts`.
 *  Serving one would make the CONTROL fail on main for a path-resolution reason rather than
 *  an overwrite one -- and a control that cannot pass in the world it is controlling for is
 *  not a control. With both present the script writes in EITHER version, so the only thing
 *  that moves between them is the marker behaviour under test. */
function writeSyntheticCf(root: string): void {
  const src = join(root, "cf", "modules", "plan-enhance", "src");
  mkdirSync(src, { recursive: true });
  const body = `export const MANIFEST = {
  "name": "plan-enhance",
  "version": "0.2.1",
  "api": "vivijure-module/2",
  "provides": [{ "hook": "plan.enhance", "label": "Opus auto-direction" }]
};
`;
  writeFileSync(join(src, "manifest.ts"), body, "utf8");
  writeFileSync(join(src, "index.ts"), body, "utf8");
}

/** Run the REAL sync script inside the temp tree, writing the REAL (non-MANIFESTS_OUT) path. */
function runSync(root: string): string {
  try {
    return execFileSync("npx", ["tsx", join(root, "scripts", "sync-module-manifests.ts")], {
      cwd: repo,
      encoding: "utf8",
      // DELETE the key. Setting it to "" is not "unset": the script reads it with `??`,
      // which only defaults on nullish, so "" would become the output PATH.
      env: (() => {
        const e: NodeJS.ProcessEnv = { ...process.env, VIVIJURE_SRC: join(root, "cf") };
        delete e.MANIFESTS_OUT;
        return e;
      })(),
    });
  } catch (e) {
    // A script that could not RUN is a harness failure. Saying so keeps it from reading as
    // "the subject behaved wrongly", which is how three transform errors nearly passed for
    // three findings.
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    throw new Error(
      `HARNESS FAILURE: the sync script did not run.\n${String(err.stderr ?? "")}\n${String(err.message ?? "")}`,
    );
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "joan-local-fixes-313-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "dev", "manifests"), { recursive: true });
  // The repo's package.json carries "type": "module". Without it here esbuild treats the
  // copied script as CJS and refuses its top-level await, which fails as a TRANSFORM error
  // rather than an assertion -- a harness fault that reddens like a finding.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }) + "\n", "utf8");
  cpSync(join(repo, "scripts", "sync-module-manifests.ts"), join(dir, "scripts", "sync-module-manifests.ts"));
  writeSyntheticCf(dir);
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("local#313: a marked fixture survives regeneration", () => {
  // CONTROL FIRST. Without the marker the script MUST overwrite. If this does not fire, the
  // preservation test below is consistent with "the script never wrote anything at all",
  // which is the reading that would make the whole file decorative.
  it("CONTROL: an UNMARKED fixture is overwritten by cf, proving the script can write", () => {
    const target = join(dir, "dev", "manifests", "plan-enhance.json");
    const before = JSON.stringify(
      { name: "plan-enhance", version: "0.3.1", api: "vivijure-module/2", provides: [{ hook: "plan.enhance", label: "Ollama auto-direction (homelab)" }] },
      null,
      2,
    ) + "\n";
    writeFileSync(target, before, "utf8");

    const out = runSync(dir);
    const after = readFileSync(target, "utf8");
    const evidence = `script said: ${out.trim()}`;

    expect(after, `the control did not overwrite, so this file proves nothing. ${evidence}`).not.toBe(before);
    expect(JSON.parse(after).version, evidence).toBe("0.2.1");
    expect(JSON.parse(after).provides[0].label, evidence).toMatch(/Opus/);
  });

  it("a fixture carrying the marker is left byte-identical", () => {
    const target = join(dir, "dev", "manifests", "plan-enhance.json");
    // The SHIPPED fixture, marker and all, rather than a hand-written stand-in.
    const before = readFileSync(join(repo, "dev", "manifests", "plan-enhance.json"), "utf8");
    expect(before, "the shipped fixture must carry the marker for this test to mean anything").toContain(
      '"_local_divergence": "do-not-sync"',
    );
    writeFileSync(target, before, "utf8");

    const out = runSync(dir);
    const after = readFileSync(target, "utf8");
    const evidence = `script said: ${out.trim()}`;

    expect(after, `the marker did not protect the file. ${evidence}`).toBe(before);
    expect(out, "the skip must be ANNOUNCED, not silent").toMatch(/skip \(local divergence marker/);
    expect(out).toMatch(/preserved 1 local-divergence fixture/);
  });

  it("MANIFESTS_OUT still gets the cf shape, so the checker's diff keeps working", () => {
    // The asymmetry is load-bearing and easy to get backwards: protecting the temp-dir regen
    // too would make the checker compare cf against itself and never report drift again.
    const outDir = join(dir, "regen");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(dir, "dev", "manifests", "plan-enhance.json"),
      readFileSync(join(repo, "dev", "manifests", "plan-enhance.json"), "utf8"),
      "utf8",
    );
    const out = execFileSync("npx", ["tsx", join(dir, "scripts", "sync-module-manifests.ts")], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, VIVIJURE_SRC: join(dir, "cf"), MANIFESTS_OUT: outDir },
    });
    const regen = JSON.parse(readFileSync(join(outDir, "plan-enhance.json"), "utf8")) as { version?: string };
    expect(regen.version, `script said: ${out.trim()}`).toBe("0.2.1");
    expect(out, "the real-tree protection must NOT engage under MANIFESTS_OUT").not.toMatch(
      /skip \(local divergence marker/,
    );
  });
});

describe("local#313: the checker discovers exclusions from the marker, not a hand list", () => {
  const script = (): string => readFileSync(join(repo, "scripts", "check-module-manifest-drift.sh"), "utf8");

  it("CONTROL: the checker is readable and non-trivial", () => {
    const n = script().split("\n").filter((l) => l.trim() !== "").length;
    expect(n, `read ${n} non-blank lines`).toBeGreaterThan(40);
  });

  it("the hand-maintained EXCLUDE_RE is gone", () => {
    expect(
      script(),
      "a hand list in the checker is a second copy of institutional memory and drifts from it",
    ).not.toMatch(/EXCLUDE_RE=/);
  });

  it("exclusions come from the marker, and the pass line names them", () => {
    const s = script();
    expect(s).toMatch(/_local_divergence/);
    expect(s).toMatch(/is_local_divergence/);
    // A skip nobody can see is how an exclusion becomes a blind spot.
    expect(s, "the pass line must name what it excluded").toMatch(/local-divergence/);
  });

  it("REGRESSION: no pin. A parity guard that pins cannot go red on drift", () => {
    const s = script();
    expect(s, "local#403 closed local#362 on exactly this argument").not.toMatch(/cf-manifest-pin/);
    expect(s).not.toMatch(/PIN_FILE/);
  });
});
