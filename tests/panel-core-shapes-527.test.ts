import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_CARDINALITY } from "@skyphusion-labs/vivijure-core/modules/types";
import { STORYBOARD_MAX_SCENES } from "@skyphusion-labs/vivijure-core/storyboard-validate";

// local#527. Two panel files assumed core 1.26 after the host moved to core 1.43+:
//  - core 1.38.0 (core#471) gave the `score` hook the cardinality `pick_one_per_kind`. The module-host
//    page badges each stage from CARDINALITY_LABEL, which knew only pick_one and chain, so the score
//    stage printed the raw token.
//  - core 1.36.0 (core#465) raised STORYBOARD_MAX_SCENES from 50 to 600. The planner's beat plan
//    clamped to its own copy, still 50.
// Both are held to core here, read from the shipped files, so the next core change cannot leave the
// panel behind without this going red.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("the panel follows core's shapes (local#527)", () => {
  it("every cardinality core declares has a badge label on the module-host page", () => {
    const app = read("public/app.js");
    const m = /const CARDINALITY_LABEL = \{([^}]*)\};/.exec(app);
    expect(m, "CARDINALITY_LABEL literal").not.toBeNull();
    const labelled = new Set([...m![1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]));
    const declared = [...new Set(Object.values(HOOK_CARDINALITY))].sort();
    expect(declared).toContain("pick_one_per_kind");
    expect(declared.filter((c) => !labelled.has(c))).toEqual([]);
  });

  it("the beat plan clamps at core's scene cap", () => {
    const audio = read("public/planner-audio.js");
    const m = /^const PLANNER_MAX_SCENES = ([\d_]+);/m.exec(audio);
    expect(m, "PLANNER_MAX_SCENES literal").not.toBeNull();
    expect(Number(m![1].replaceAll("_", ""))).toBe(STORYBOARD_MAX_SCENES);
  });
});
