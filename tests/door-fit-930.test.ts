/// <reference types="node" />
// vivijure-cf#930, dual panel with vivijure-cf: core 1.47.0 moves a lined shot off a film door whose clip
// floor would leave the speaker mouthing silence, for that one clip, or records the tail. This repo builds
// the offer (src/door-fit-offer.ts, voiced film route m9) and shows the record on the panel
// (public/finish-degrade.js renderSignalLines), in the same sentences as vivijure-cf.
import { describe, expect, it } from "vitest";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core";
import * as fd from "../public/finish-degrade.js";
import type { RenderOutput } from "../public/finish-degrade.js";
import { DOOR_FIT_FOR_EXPLICIT_FILM_DOOR, doorFitOffer } from "../src/door-fit-offer.js";

function motion(name: string, usage: Record<string, unknown>, order: number, locality = "local", schema: Record<string, unknown> = {}): RegisteredModule {
  return {
    name, binding: `MODULE_${name.toUpperCase().replace(/-/g, "_")}`, version: "1.0.0", api: "vivijure-module/2",
    hooks: ["motion.backend"], usage, config_schema: schema, ui: { order, section: "motion", locality },
  } as unknown as RegisteredModule;
}
const base = { voice: "cast_tts", scatter_native_audio: false, min_seconds: 2, max_seconds: 15 };
const wanLocal = motion("wan-local", { ...base, native_audio: true, driving_audio: true, min_seconds: 5, duration_steps: [5, 10, 15] }, 10);
const talkLocal = motion("talk-local", { ...base, native_audio: false, driving_audio: true }, 20, "local", {
  generate_audio: { type: "bool", default: true },
});
const talkCloud = motion("infinitetalk", { ...base, native_audio: false, driving_audio: true }, 15, "cloud");
const silent = motion("plain-local", { ...base, native_audio: false, driving_audio: false }, 30);
const MODULES = [wanLocal, talkLocal, talkCloud, silent];

describe("the door-fit offer (cf#930, local)", () => {
  it("no named door: the film door is the first serving door, and the other driven doors of its locality are offered", () => {
    expect(doorFitOffer(MODULES, undefined, { spoken: true, explicit: false })).toEqual({
      door_fit: ["talk-local"],
      motion_configs: { "talk-local": { generate_audio: false } },
    });
  });

  it("offers nothing to a silent film or a silent film door", () => {
    expect(doorFitOffer(MODULES, undefined, { spoken: false, explicit: false })).toEqual({});
    expect(doorFitOffer(MODULES, "plain-local", { spoken: true, explicit: false })).toEqual({});
  });

  it("a film door the caller named is offered too, as in vivijure-cf (Conrad's ruling, 2026-11-11: B)", () => {
    expect(DOOR_FIT_FOR_EXPLICIT_FILM_DOOR).toBe(true);
    expect(doorFitOffer(MODULES, "wan-local", { spoken: true, explicit: true }).door_fit).toEqual(["talk-local"]);
  });
});

describe("the panel shows door_fit (cf#930, local)", () => {
  const texts = (o: RenderOutput) => fd.renderSignalLines(o).map((l) => l.text);
  const witness = { plate_check: { checked: 1, unclean: [{ shot_id: "s9", expected: 1, faces: 2 }] } };

  it("absent, empty and junk show nothing; a witness signal in the same payload does render", () => {
    for (const door_fit of [undefined, { swapped: [], tails: [] }, { swapped: "x" }, 7]) {
      const lines = texts({ ...witness, door_fit } as unknown as RenderOutput);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("extra person");
    }
  });

  it("a moved shot and a tail render in vivijure-cf's sentences", () => {
    const lines = texts({
      door_fit: {
        swapped: [{ shot_id: "shot_01", from: "wan-local", to: "talk-local", line_seconds: 1.4, planned_seconds: 2, from_clip_seconds: 5 }],
        tails: [{ shot_id: "shot_03", door: "wan-local", line_seconds: 1, clip_seconds: 5 }],
      },
    } as unknown as RenderOutput);
    expect(lines).toEqual([
      "shot_01 was made on talk-local, not wan-local: its 1.4 s line is shorter than the 5 s clip wan-local makes, and the speaker would keep mouthing words after it.",
      "shot_03: its 1 s line ends before the 5 s clip on wan-local, so the speaker keeps mouthing words after it.",
    ]);
  });
});
