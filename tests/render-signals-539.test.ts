/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as fd from "../public/finish-degrade.js";
import type { RenderOutput } from "../public/finish-degrade.js";

// local#539: the panel shows the render signals core carries to the render row, as vivijure-cf does.
//   output.content_validation  core 1.25.0  the clip picture check (cf#916)
//   output.plate_check          core 1.31.0  stills that may show an extra person (cf#1282)
//   output.keyframes_incomplete              shots that got no still (cf#1283)
//   output.keyframe_reuse       core 1.45.0  stills returned from the store, not redrawn (cf#1385)
// The ladder: key ABSENT renders nothing, a clean result renders nothing, an unrecognised shape renders
// nothing, only a reported problem renders. Every negative case carries a WITNESS, a sibling signal in
// the same call that does render, so "nothing rendered" cannot pass by the path never being entered.

const ROOT = join(import.meta.dirname, "..");
const out = (o: Record<string, unknown>) => ({ output_key: "renders/f/film.mp4", ...o }) as RenderOutput;
const texts = (o: RenderOutput) => fd.renderSignalLines(o).map((l) => l.text);
const UNCLEAN = { expected: 2, faces: [3, 3], chosen: 0, clean: false, retries: 1 };
const WITNESS = { plate_check: { checked: 2, unclean: [{ shot_id: "shot_09", expected: 2, faces: 3 }] } };
const WITNESS_LINE = "1 still may show an extra person (shot_09). Regenerate that still to try again.";

describe("content_validation", () => {
  it("absent, clean and junk render nothing, beside a witness that does", () => {
    expect(texts(out({ ...WITNESS }))).toEqual([WITNESS_LINE]);
    expect(texts(out({ content_validation: { checked: 3, unmeasured: 0, reasons: [] }, ...WITNESS }))).toEqual([WITNESS_LINE]);
    expect(texts(out({ content_validation: { checked: "3", unmeasured: 0 }, ...WITNESS }))).toEqual([WITNESS_LINE]);
    // Unrecognised counts beside a failed clip: still not a shape we read, so nothing renders.
    expect(texts(out({ content_validation: { checked: "3", unmeasured: "1", degraded: [{ shot_id: "x", reason: "r" }] }, ...WITNESS })))
      .toEqual([WITNESS_LINE]);
  });

  it("names failed and unmeasured clips, and keeps the studio's reasons verbatim", () => {
    const lines = fd.renderSignalLines(out({
      content_validation: {
        checked: 3, unmeasured: 2, reasons: ["video-finish /inspect unreachable"],
        degraded: [{ shot_id: "shot_02", reason: "first frame does not resemble its keyframe" }],
      },
    }));
    expect(lines).toEqual([{
      text: "1 clip failed the picture check and may look wrong. 2 clips were not checked for picture problems.",
      reasons: ["shot_02: first frame does not resemble its keyframe", "video-finish /inspect unreachable"],
    }]);
  });
});

describe("plate_check and per-still plate_count", () => {
  it("names the unclean stills; clean and junk render nothing beside a witness", () => {
    expect(texts(out({ plate_check: { checked: 2, unclean: [{ shot_id: "a" }, { shot_id: "b" }] } })))
      .toEqual(["2 stills may show an extra person (a, b). Regenerate those stills to try again."]);
    expect(texts(out({ plate_check: { checked: 2, unclean: [] }, keyframes_incomplete: { adopted: 2, expected: 3, dropped: ["shot_03"] } })))
      .toEqual(["1 of 3 shots got no still, so this film was made without it (shot_03)."]);
    expect(fd.parsePlateCheck({ unclean: [] })).toBeNull();
  });

  it("a still warns from its own plate_count or from the render-level list, only on clean: false", () => {
    const o = out({ plate_check: { checked: 2, unclean: [{ shot_id: "shot_02" }] } });
    expect(fd.shotWarnings(o, "shot_01", { plate_count: UNCLEAN })).toEqual([fd.STILL_EXTRA_PERSON]);
    expect(fd.shotWarnings(o, "shot_02", {})).toEqual([fd.STILL_EXTRA_PERSON]);
    expect(fd.shotWarnings(o, "shot_03", { plate_count: { ...UNCLEAN, clean: true } })).toEqual([]);
    expect(fd.shotWarnings(o, "shot_03", { plate_count: "junk" })).toEqual([]);
    // A report with no clean field is "not measured", never a warning.
    expect(fd.shotWarnings(o, "shot_03", { plate_count: { expected: 2, faces: [3] } })).toEqual([]);
  });

  it("a still whose clip failed the picture check says so", () => {
    const o = out({ content_validation: { checked: 2, unmeasured: 0, degraded: [{ shot_id: "shot_01", reason: "x" }] } });
    expect(fd.shotWarnings(o, "shot_01", null)).toEqual(["This clip failed the picture check and may look wrong."]);
    expect(fd.shotWarnings(o, "shot_02", null)).toEqual([]);
  });
});

describe("keyframes_incomplete", () => {
  it("counts from the dropped list, else from expected - adopted", () => {
    expect(texts(out({ keyframes_incomplete: { adopted: 1, expected: 3, dropped: ["shot_02", "shot_03"] } })))
      .toEqual(["2 of 3 shots got no still, so this film was made without them (shot_02, shot_03)."]);
    expect(texts(out({ keyframes_incomplete: { adopted: 2, expected: 4 } })))
      .toEqual(["2 of 4 shots got no still, so this film was made without them."]);
    expect(texts(out({ keyframes_incomplete: { adopted: 3, expected: 3, dropped: [] }, ...WITNESS }))).toEqual([WITNESS_LINE]);
  });
});

describe("keyframe_reuse (cf#1385, core#532)", () => {
  it("reads the core shape; absent, junk and empty are null", () => {
    expect(fd.parseKeyframeReuse({ stills: 5, reused: ["shot_01", 7, "shot_01", "shot_03"] }))
      .toEqual({ stills: 5, reused: ["shot_01", "shot_03"] });
    expect(fd.parseKeyframeReuse(undefined)).toBeNull();
    expect(fd.parseKeyframeReuse({ stills: 3, reused: [] })).toBeNull();
    expect(fd.parseKeyframeReuse({ stills: "3", reused: ["a"] })).toBeNull();
  });

  it("the row line counts the reused stills and says how to get a new picture", () => {
    expect(fd.reuseNote(out({ keyframe_reuse: { stills: 3, reused: ["shot_01", "shot_03"] } })))
      .toBe("2 of 3 stills were reused from an earlier render with the same settings, not redrawn. " + fd.NEW_PICTURE_HINT);
    expect(fd.reuseNote(out({}))).toBe("");
    expect(fd.reuseNote(out({ keyframe_reuse: { stills: 2, reused: ["a"] } }))).not.toBe("");
  });

  it("the tag marks a still from its own entry or the list, and only on a literal true", () => {
    const o = out({ keyframe_reuse: { stills: 3, reused: ["shot_02"] } });
    expect(fd.keyframeReused(o, { shot_id: "shot_01", reused: true })).toBe(true);
    expect(fd.keyframeReused(o, { shot_id: "shot_02" })).toBe(true);
    expect(fd.keyframeReused(o, { shot_id: "shot_03", reused: "true" })).toBe(false);
  });
});

describe("the history row wires every signal", () => {
  const js = readFileSync(join(ROOT, "public/planner-history-row.js"), "utf8");
  const css = readFileSync(join(ROOT, "public/styles.css"), "utf8");
  it("row lines, per-still warnings, the reuse tag and the regen wording", () => {
    expect(js).toContain("fdSignals.renderSignalLines(r.output)");
    expect(js).toContain("fdSignals.reuseNote(r.output)");
    expect(js).toContain("window.finishDegrade.shotWarnings(r.output, kf.shot_id, kf)");
    expect(js).toContain("window.finishDegrade.keyframeReused(r.output, kf)");
    expect(js).toContain("regen keeps this render's settings, including its seed.");
  });
  it("a collapsed row hides the new lines like its other detail lines", () => {
    expect(css).toContain(".planner-history-item-collapsed .planner-history-signal,");
    expect(css).toContain(".planner-history-item-collapsed .planner-history-reuse-note,");
  });
});
