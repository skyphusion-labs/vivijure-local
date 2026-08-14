// local#295: local CI must not float on vivijure-cf main for quality-tier-drift.
// A pin file + workflow ref is the deliberate contract; this test fails if either half
// is removed or rewritten to track floating main.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function pinSha(): string {
  const raw = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
  const m = raw.match(/^SHA=([0-9a-f]{40})\s*$/m);
  if (!m) throw new Error("dev/cf-quality-tier-pin missing SHA=<40-char hex>");
  return m[1];
}

describe("vivijure-cf quality-tier pin (local#295)", () => {
  it("dev/cf-quality-tier-pin holds a full 40-char commit SHA", () => {
    const sha = pinSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const body = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
    expect(body).toMatch(/local#295/);
    expect(body).toMatch(/quality-tier-drift/);
    // Explicitly not for manifest-drift / containers-drift.
    expect(body).toMatch(/NOT used by manifest-drift/i);
  });

  it("ci.yml checks out vivijure-cf at the pin, not floating main", () => {
    const yml = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    expect(yml).toContain("local#295");
    expect(yml).toContain("dev/cf-quality-tier-pin");
    expect(yml).toContain("steps.cf_pin.outputs.sha");
    // Must not hardcode ref: main on the quality-tier checkout step.
    const qtBlock = yml.split("Checkout vivijure-cf")[1] ?? "";
    expect(qtBlock).toMatch(/ref:\s*\$\{\{\s*steps\.cf_pin\.outputs\.sha\s*\}\}/);
    expect(qtBlock).not.toMatch(/ref:\s*main\b/);
    // Whole modules/ tree, not a hand-listed sparse subset.
    expect(qtBlock).toMatch(/sparse-checkout:[\s\S]*modules/);
    expect(qtBlock).toMatch(/sparse-checkout-cone-mode:\s*true/);
    // Preflight names the issue so the next miss is self-diagnosing.
    expect(yml).toMatch(/Preflight quality-tier cf checkout \(local#295\)/);
  });

  // local#295 follow-up. The test that used to sit here was titled "pin SHA matches the
  // value the workflow will request" and its whole body was `expect(pinSha().length).toBe(40)`.
  // pinSha() already matches /^SHA=([0-9a-f]{40})\s*$/m, so length 40 was guaranteed by the
  // parser and the assertion was a tautology: it could not fail for ANY well-formed pin file.
  //
  // MEASURED, not argued. Mutating the shipped pin:
  //   SHA=deadbeef                                  -> 2 failed | 1 passed  (parser catches it)
  //   SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef  -> 3 passed              (nothing catches it)
  // The well-formed-but-wrong case is the one that matters and it was invisible.
  //
  // What a test in this repo CAN settle is the CONTRACT between the pin file and the
  // workflow. It cannot settle whether the SHA is a real vivijure-cf commit; that is a fact
  // about another repo and needs the network (see the pin-staleness note on the PR).
  //
  // So this EXECUTES the workflow's own extraction rather than describing it, and it lifts
  // that shell out of ci.yml rather than transcribing it. A suite that defines both halves
  // of a contract is a self-consistency check wearing an integration test's clothes: with a
  // transcribed copy, ci.yml could change and this would stay green forever.
  describe("the pin file and the workflow agree, proved by running the workflow's own shell", () => {
    const STEP = "Read vivijure-cf pin (quality-tier-drift only)";

    /** Lift the `run: |` block of a named step out of ci.yml. Refuses on an unknown step. */
    function stepScript(stepName: string): string {
      const yml = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
      const lines = yml.split("\n");
      const at = lines.findIndex((l) => l.includes(`name: ${stepName}`));
      if (at < 0) {
        // A renamed step must REFUSE, not yield an empty script that passes vacuously.
        throw new Error(`ci.yml has no step named ${stepName}; this guard cannot run`);
      }
      const runAt = lines.findIndex((l, i) => i > at && /^\s*run:\s*\|\s*$/.test(l));
      if (runAt < 0 || runAt - at > 12) throw new Error(`no 'run: |' block found under ${stepName}`);
      const indent = (lines[runAt].match(/^\s*/) ?? [""])[0].length + 2;
      const body: string[] = [];
      for (let i = runAt + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === "") {
          body.push("");
          continue;
        }
        const lead = (l.match(/^\s*/) ?? [""])[0].length;
        if (lead < indent) break;
        body.push(l.slice(indent));
      }
      return body.join("\n").replace(/\s+$/, "");
    }

    it("CONTROL: the extractor lifts a real script, and REFUSES an unknown step name", () => {
      const script = stepScript(STEP);
      // Denominator beside the claim: an empty lift would make every assertion below vacuous.
      const nonEmpty = script.split("\n").filter((l) => l.trim() !== "").length;
      expect(nonEmpty, `lifted script:\n${script}`).toBeGreaterThan(5);
      expect(script, `lifted script:\n${script}`).toContain("dev/cf-quality-tier-pin");
      expect(() => stepScript("a step name that does not exist")).toThrow(/no step named/);
    });

    it("running that shell against the real pin file emits exactly the pinned SHA", () => {
      const script = stepScript(STEP);
      const dir = mkdtempSync(join(tmpdir(), "joan-local-fixes-295b-"));
      try {
        const scriptPath = join(dir, "cf_pin_step.sh");
        const outPath = join(dir, "github_output");
        writeFileSync(scriptPath, script, "utf8");
        writeFileSync(outPath, "", "utf8");
        // cwd is the repo root because the step declares working-directory: vivijure-local,
        // which is this repo's checkout path in CI.
        const stdout = execFileSync("bash", [scriptPath], {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, GITHUB_OUTPUT: outPath },
        });
        const written = readFileSync(outPath, "utf8");
        const evidence = `GITHUB_OUTPUT=${JSON.stringify(written)} stdout=${JSON.stringify(stdout)}`;
        expect(written.trim(), evidence).toBe(`sha=${pinSha()}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("exactly ONE SHA= line, because the workflow takes head -1", () => {
      const raw = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
      const shaLines = raw.split("\n").filter((l) => /^SHA=/.test(l));
      expect(
        shaLines.length,
        `a second SHA= line silently decides the pin via head -1. lines=${JSON.stringify(shaLines)}`,
      ).toBe(1);
    });
  });
});

// local#295 follow-up. Something must assert the pin is not drifting; before this nothing
// did. The load-bearing property is not that the check EXISTS but WHERE it runs: a
// staleness gate on the pull_request path would red every open local PR the moment cf
// merges enough commits, which is precisely the coupling this pin exists to remove. The
// remedy is the absence of that trigger, so the guard asserts on the ABSENCE -- sync-checking
// what remains protects the copies you kept, only an absence assertion protects the removal.
describe("cf pin staleness is asserted, and NOT on the PR path (local#295)", () => {
  const WF = ".github/workflows/cf-pin-staleness.yml";
  const wf = (): string => readFileSync(resolve(root, WF), "utf8");

  it("CONTROL: the workflow exists and is non-trivial", () => {
    const y = wf();
    // Denominator beside the claim: an empty read would make every absence below vacuous.
    expect(y.split("\n").filter((l) => l.trim() !== "").length, `len=${y.length}`).toBeGreaterThan(20);
    expect(y).toContain("dev/cf-quality-tier-pin");
    expect(y).toContain("local#295");
  });

  it("runs on a schedule and on demand", () => {
    const y = wf();
    expect(y).toMatch(/^on:/m);
    expect(y).toMatch(/^\s+schedule:/m);
    expect(y).toMatch(/^\s+-\s*cron:/m);
    expect(y).toMatch(/^\s+workflow_dispatch:/m);
  });

  it("REGRESSION: it must never gain a pull_request or push trigger", () => {
    const y = wf();
    // Scope to the trigger block: `pull_request` may legitimately appear in prose below it,
    // and a whole-file match would count its own explanation as a violation.
    const onBlock = y.split(/^on:/m)[1]?.split(/^[a-z]+:/m)[0] ?? "";
    expect(onBlock.length, "could not isolate the trigger block").toBeGreaterThan(10);
    expect(
      onBlock,
      "gating PRs on cf drift is the coupling local#295 removed; a scheduled red blocks nobody",
    ).not.toMatch(/pull_request/);
    expect(onBlock).not.toMatch(/\bpush\b/);
  });

  it("it fails on a threshold, rather than only printing one", () => {
    const y = wf();
    expect(y).toMatch(/MAX_BEHIND_COMMITS/);
    expect(y).toMatch(/MAX_AGE_DAYS/);
    // A number emitted next to an action that does not consume it is not a control.
    expect(y).toMatch(/exit 1/);
    // And it proves the pin resolves before believing any comparison, so an errored
    // compare cannot read as "zero behind".
    expect(y).toMatch(/CONTROL: pinned commit resolves/);
  });

  it("the thresholds live in the pin file, so tightening them is one line", () => {
    const raw = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
    const lines = raw.split("\n");
    expect(lines.filter((l) => /^MAX_BEHIND_COMMITS=\d+$/.test(l)).length).toBe(1);
    expect(lines.filter((l) => /^MAX_AGE_DAYS=\d+$/.test(l)).length).toBe(1);
    // Adding policy lines must not have disturbed the one the workflow greps for.
    expect(lines.filter((l) => /^SHA=/.test(l)).length).toBe(1);
  });
});
