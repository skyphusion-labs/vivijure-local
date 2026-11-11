// local#528: music and narration are chosen by declared score_kind (core#471),
// not by which config keys the module happens to have.
import { describe, expect, it } from "vitest";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core/modules/types";
import { musicScoreModules, narrationScoreModules } from "../src/score-bed.js";

function mod(name: string, score_kind: string | undefined, schema: Record<string, unknown>): RegisteredModule {
  return {
    name,
    hooks: ["score"],
    score_kind,
    config_schema: schema,
  } as RegisteredModule;
}

describe("local#528 score modules are picked by declared kind", () => {
  const swapped = [
    mod("music-gen", "music", { text: { type: "string" } }),
    mod("narration-gen", "narration", { prompt: { type: "string" } }),
    mod("schema-only", undefined, { prompt: { type: "string" }, text: { type: "string" } }),
  ];

  it("a music kind with no prompt key is music, and a prompt key with no kind is not", () => {
    expect(musicScoreModules(swapped).map((m) => m.name)).toEqual(["music-gen"]);
  });

  it("a narration kind with no text key is narration, and a text key with no kind is not", () => {
    expect(narrationScoreModules(swapped).map((m) => m.name)).toEqual(["narration-gen"]);
  });
});
