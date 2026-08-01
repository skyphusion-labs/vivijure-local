// A MODULE WITH NO IMPLEMENTATION BEHIND IT IS NOT A MODULE (local#291).
//
// vivijure-local ships no RIFE image and no local RIFE path (Conrad 2026-07-28). That decision was
// already recorded in four places -- the build workflow, src/modules/finish-backend.ts,
// scripts/finish-module-server.ts, src/modules/local-finish/handlers.ts -- and the panel still
// rendered a full set of RIFE knobs, because scripts/dev-module-fleet.sh stood the module up for the
// registry to discover and the frontend is a projection of the registry. The knobs were real
// controls (interpolate, interpolation_factor 2x/4x/8x, face_restore, face_fidelity, only_faces) and
// the only path behind them was a cloud call, on a panel whose premise is that RunPod is opt-in.
//
// Third instance of one shape: local#223, local#229 (local-gpu advertising SDXL while serving the GPU
// mock), local#278 ("Free after hardware" over a door that needs commercial registration).
//
// THE FENCE IS IN TWO HALVES, because the defect had two halves:
//
//   ABSENCE     nothing a local install can stand up may advertise RIFE. Asserted against the two
//               artifacts that decide it: the compose file (can any profile bring it up?) and the
//               dev fleet script (does the documented fleet stand it up?).
//   HONESTY     the resulting empty finish step must read as the local ANSWER, not as a hole. The
//               panel's empty-hook projection is the pure helper public/render-hook-gaps.js.
//
// EVERY absence assertion here carries a POSITIVE CONTROL in the same test: a fence that would pass
// against an empty file, a renamed key, or a helper that returns nothing certifies coverage it does
// not have. That is the whole reason each `not.toContain` below sits next to a `toContain`.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import gaps from "../public/render-hook-gaps.js";

const REPO = join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

/** Service keys under `services:` in compose.yaml (two-space indented `name:`).
 *
 *  Deliberately a TEXT read rather than `docker compose config`: the claim is "no service by this
 *  name exists in the file", which is stronger than "no profile renders it" and needs no daemon. A
 *  service absent from the file cannot be produced by any profile, so profile resolution has nothing
 *  to add here (contrast tests/localgpu-lane-280.test.ts, where the claim IS about profiles and the
 *  compose CLI is the right resolver). */
function composeServices(): string[] {
  const lines = read("compose.yaml").split("\n");
  const start = lines.findIndex((l) => l === "services:");
  expect(start).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break; // next top-level key ends the block
    const m = /^ {2}([a-z0-9][a-z0-9._-]*):\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The `name port` rows the dev fleet actually starts (the MODULE_PORTS heredoc). */
function devFleetModules(): string[] {
  const src = read("scripts/dev-module-fleet.sh");
  // Anchored on the heredoc OPENER, not on the whole `read` line: the opener carries a trailing
  // `|| true`, and a slice regex that overruns or undershoots its terminator reads the wrong object
  // with total confidence. The null-guard below is what turned that into a loud failure.
  const body = /MODULE_PORTS <<'EOF'[^\n]*\n([\s\S]*?)\nEOF/.exec(src);
  expect(body, "MODULE_PORTS heredoc not found; the fleet script shape changed").not.toBeNull();
  return (body as RegExpExecArray)[1]
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]);
}

describe("absence: nothing a local install stands up advertises RIFE", () => {
  it("compose.yaml declares no finish-rife service, in any profile", () => {
    const names = composeServices();
    expect(names.filter((n) => n.includes("rife"))).toEqual([]);
  });

  it("...and the finish sidecars that DO exist are still declared (positive control)", () => {
    // Without this the assertion above passes against a compose.yaml this parser failed to read at
    // all -- an empty list contains nothing, including the thing under test.
    const names = composeServices();
    expect(names).toContain("module-finish-lipsync");
    expect(names).toContain("module-finish-upscale");
    expect(names).toContain("studio");
    expect(names.length).toBeGreaterThan(10);
  });

  it("the documented dev fleet does not stand finish-rife up", () => {
    expect(devFleetModules()).not.toContain("finish-rife");
  });

  it("...and it still stands the rest of the catalog up (positive control)", () => {
    const mods = devFleetModules();
    expect(mods).toContain("finish-lipsync");
    expect(mods).toContain("finish-upscale");
    expect(mods).toContain("keyframe");
    expect(mods.length).toBeGreaterThan(10);
  });

  it("every module the fleet stands up has a compose service behind it", () => {
    // THE RULE THE FLEET LIST HAS TO OBEY, stated as an invariant rather than as one banned name: a
    // manifest-only sidecar stands in for the DISCOVERY of a module, so it is honest only while the
    // module is one a local install can actually bring up. finish-rife was the only entry that
    // failed this, which is exactly why it was the one advertising a capability with nothing behind
    // it. Naming-convention note: the fleet uses the module name, compose prefixes it `module-`,
    // except the two finish sidecars compose names after the module and the local-gpu door.
    const services = new Set(composeServices());
    const missing = devFleetModules().filter(
      (m) => !services.has(`module-${m}`) && !services.has(m),
    );
    expect(missing).toEqual([]);
  });
});

describe("the fixture is a fixture, not an installed module", () => {
  it("dev/manifests/finish-rife.json still exists and stays in the sync list", () => {
    // Kept ON PURPOSE, and the two reasons are not "vivijure-local ships RIFE":
    //   1. check-module-manifest-drift.sh diffs every committed fixture against vivijure-cf and
    //      fails on an orphan, so fixture and sync-list entry live or die together;
    //   2. an operator who wires RIFE to RunPod explicitly reads the config schema from it.
    // Deleting either half is a decision, not a cleanup -- so both halves are pinned here.
    expect(existsSync(join(REPO, "dev/manifests/finish-rife.json"))).toBe(true);
    expect(read("scripts/sync-module-manifests.ts")).toContain('"finish-rife",');
  });

  it("the directory says so in prose, naming finish-rife specifically", () => {
    // A JSON fixture cannot carry the note itself: the drift check diffs it BYTE FOR BYTE against
    // the regenerated file, so any comment key added to it is instant DRIFT. The note therefore
    // lives beside it, and this asserts it is actually about this case rather than generic boilerplate.
    const readme = read("dev/manifests/README.md");
    expect(readme).toContain("finish-rife.json");
    expect(readme).toContain("A fixture is not a module");
  });

  it("no audit or smoke script requires finish-rife to be bound on a local studio", () => {
    // finish-stack-verify.ts used to record `fail` for `module bound: finish-rife`, so a correctly
    // built local finish stack audited as broken. smoke-exhaustive.ts sent finish_config for it
    // while docs/FINISH_BACKEND.md said the homelab smoke runs "no RIFE step".
    expect(read("scripts/finish-stack-verify.ts")).not.toContain('"finish-rife", "finish-lipsync"');
    expect(read("scripts/smoke-exhaustive.ts")).not.toContain('"finish-rife": {');
    // Positive control: both scripts still check / configure the finish modules that DO exist.
    expect(read("scripts/finish-stack-verify.ts")).toContain('"finish-lipsync"');
    expect(read("scripts/smoke-exhaustive.ts")).toContain('"finish-lipsync": {');
  });
});

// --------------------------------------------------------------------------- honesty half

const CATALOG = [
  { name: "keyframe", blurb: "storyboard -> start keyframes (SDXL)", cardinality: "pick_one", order: 40 },
  { name: "motion.backend", blurb: "keyframe -> shot clip (GPU or cloud)", cardinality: "pick_one", order: 50 },
  { name: "speech", blurb: "clean / enhance dialogue audio", cardinality: "chain", order: 70 },
  { name: "finish", blurb: "interpolation / upscale / face restore", cardinality: "chain", order: 80 },
  { name: "master", blurb: "film-level audio mastering: music upscale + loudness", cardinality: "chain", order: 100 },
];

const PANEL_HOOKS = [
  { hook: "keyframe", pickOne: true },
  { hook: "motion.backend", pickOne: true },
  { hook: "speech", pickOne: false },
  { hook: "finish", pickOne: false },
  { hook: "master", pickOne: false },
];

function only(hook: string, index: Record<string, string[]>, un: Record<string, string> = {}) {
  return gaps.gaps(PANEL_HOOKS, CATALOG, index, un).filter((g) => g.hook === hook);
}

describe("honesty: an empty finish step reads as the local answer, not as a hole", () => {
  it("an empty CHAIN hook gets a note that states the fact AND the outcome", () => {
    const [note] = only("finish", { master: ["audio-master"] });
    expect(note).toBeDefined();
    expect(note.source).toBe("empty-chain");
    // The fact.
    expect(note.text).toContain("no module is installed for this step");
    // The outcome, positively -- this is local#291 item 4. Without it the line is just a hole with
    // a sentence attached, which is the state the issue was filed about.
    expect(note.text).toContain("Renders are delivered without it");
    expect(note.text).toContain("complete render, not a missing piece");
    // Identified by the catalog's own blurb, so the reader knows WHICH step.
    expect(note.text).toContain("interpolation / upscale / face restore");
  });

  it("the note names no module, and no RIFE", () => {
    // The panel is a projection of the registry. The moment this line mentions a module by name it
    // has become the hardcoded per-feature section this whole design exists to avoid -- and it would
    // be advertising RIFE again, in prose, having just removed it from the registry.
    const all = gaps.gaps(PANEL_HOOKS, CATALOG, {});
    for (const g of all) {
      expect(g.text.toLowerCase()).not.toContain("rife");
      expect(g.text).not.toContain("finish-rife");
      expect(g.text).not.toContain("finish-lipsync");
      expect(g.text).not.toContain("RunPod");
    }
  });

  it("a hook that IS served gets no note (positive control for the whole helper)", () => {
    // Controls the assertions above: they would all pass against a helper that returns [] always.
    const served = gaps.gaps(PANEL_HOOKS, CATALOG, {
      speech: ["speech-upscale"],
      finish: ["finish-lipsync", "finish-upscale"],
      master: ["audio-master"],
    });
    expect(served).toEqual([]);
    // ...and the same call with nothing installed DOES produce lines, for all three chain hooks.
    expect(gaps.gaps(PANEL_HOOKS, CATALOG, {}).map((g) => g.hook)).toEqual([
      "speech",
      "finish",
      "master",
    ]);
  });

  it("an empty PICK_ONE hook gets NO note: a hole is the host's story", () => {
    // keyframe / motion.backend with zero modules is not a fold over nothing, it is a step that
    // cannot run. src/local-door-availability.ts reports it with an operator-actionable reason.
    // A cheerful "renders are delivered without it" line here would be a lie in the other direction.
    const all = gaps.gaps(PANEL_HOOKS, CATALOG, {}).map((g) => g.hook);
    expect(all).not.toContain("keyframe");
    expect(all).not.toContain("motion.backend");
  });

  it("where the host declared a reason, it is rendered VERBATIM instead", () => {
    // Same doctrine as hook-availability-checks.js: the operator wrote the truest available
    // description and we never rewrite, prettify or soften it. Without this branch a host-declared
    // reason on a hook with zero serving modules has no control to attach to and nobody renders it.
    const reason = "Video finishing is unavailable on this studio because the tier is not configured.";
    const [note] = only("finish", {}, { finish: reason });
    expect(note.source).toBe("host");
    expect(note.text).toBe(reason);
  });

  it("junk yields nothing rather than a wall of warnings on a healthy studio", () => {
    expect(gaps.gaps(null, null, null, null)).toEqual([]);
    expect(gaps.gaps(undefined, CATALOG, undefined, undefined)).toEqual([]);
    expect(gaps.gaps([{ hook: "", pickOne: false }], CATALOG, {})).toEqual([]);
  });

  it("a hook the catalog gives no blurb for is named by its hook name alone", () => {
    // Never invent a description for a hook we do not know: an unblurbed hook still gets an honest
    // line, it is just shorter.
    const note = gaps.gaps([{ hook: "future.hook", pickOne: false }], CATALOG, {})[0];
    expect(note.text.startsWith("future.hook: no module is installed")).toBe(true);
  });
});
