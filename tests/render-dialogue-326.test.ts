// local#326: the one dialogue resolution every render door calls (src/render-dialogue.ts), driven
// through core's REAL readBundleScenes against a real gzip+ustar bundle (tests/helpers/voiced-bundle).
import { describe, expect, it } from "vitest";
import { resolveRenderDialogue } from "../src/render-dialogue.js";
import { bundleTarGz, storeEnv, storyboardYaml } from "./helpers/voiced-bundle.js";

const KEY = "bundles/voiced.tar.gz";
// A studio with a speech provider: one module serving the dialogue hook (local#279 refuses without one).
const SPEAKS = [
  { name: "dialogue-gen", binding: "MODULE_DIALOGUE", version: "1.0.0", api: "vivijure-module/2", hooks: ["dialogue"], ui: { order: 1 } },
] as unknown as Parameters<typeof resolveRenderDialogue>[1]["modules"];
const voiced = bundleTarGz(
  storyboardYaml([
    { id: "s1", prompt: "a lighthouse", line: { slot: "A", text: "The lamp is out." } },
    { id: "s2", prompt: "the sea" },
    { id: "s3", prompt: "a boat", line: { slot: "B", text: "Row." } },
  ]),
);
type Env = Parameters<typeof resolveRenderDialogue>[0];
const env = (objs: Record<string, Uint8Array>) => storeEnv(objs) as unknown as Env;

describe("resolveRenderDialogue (local#326)", () => {
  it("derives the authored lines from the bundle, with cast voices", async () => {
    const r = await resolveRenderDialogue(env({ [KEY]: voiced }), {
      bundleKey: KEY, modules: SPEAKS,
      renderedShotIds: ["s1", "s2", "s3"],
      voices: { A: "asteria" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines?.map((l) => [l.shot_id, l.text])).toEqual([
      ["s1", "The lamp is out."],
      ["s3", "Row."],
    ]);
    expect(r.lines?.find((l) => l.shot_id === "s1")?.voice_id).toBe("asteria");
  });

  it("judges only the shots this render makes (vivijure-cf#1056)", async () => {
    const r = await resolveRenderDialogue(env({ [KEY]: voiced }), {
      bundleKey: KEY, modules: SPEAKS,
      renderedShotIds: ["s2", "s3"],
      voices: {},
    });
    expect(r.ok && r.lines?.map((l) => l.shot_id)).toEqual(["s3"]);
  });

  it("keeps every line when a rendered id is not in the bundle (no guessing)", async () => {
    const r = await resolveRenderDialogue(env({ [KEY]: voiced }), {
      bundleKey: KEY, modules: SPEAKS,
      renderedShotIds: ["s3", "not-in-bundle"],
      voices: {},
    });
    expect(r.ok && r.lines?.map((l) => l.shot_id)).toEqual(["s1", "s3"]);
  });

  it("renders silent, not refused, when the bundle is missing", async () => {
    const r = await resolveRenderDialogue(env({}), { bundleKey: KEY, modules: SPEAKS, renderedShotIds: ["s1"], voices: {} });
    expect(r).toEqual({ ok: true, lines: undefined });
  });

  it("refuses 503 when the bundle cannot be read (dialogue undetermined, fc#2250)", async () => {
    const corrupt = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5]);
    const r = await resolveRenderDialogue(env({ [KEY]: corrupt }), { bundleKey: KEY, modules: SPEAKS, renderedShotIds: ["s1"], voices: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(r.error).toMatch(/could not determine whether this storyboard has spoken lines/);
  });

  it("explicit lines win and are voiced from the cast; the bundle is read only for that", async () => {
    const explicit = [{ shot_id: "s1", text: "Explicit." }];
    const noRead = await resolveRenderDialogue(env({}), {
      bundleKey: KEY, modules: SPEAKS,
      renderedShotIds: ["s1"],
      voices: {},
      explicit: explicit as never,
    });
    expect(noRead.ok && noRead.lines).toEqual(explicit);
    const voicedLines = await resolveRenderDialogue(env({ [KEY]: voiced }), {
      bundleKey: KEY, modules: SPEAKS,
      renderedShotIds: ["s1"],
      voices: { A: "asteria" },
      explicit: explicit as never,
    });
    expect(voicedLines.ok && voicedLines.lines?.[0]).toMatchObject({ shot_id: "s1", text: "Explicit.", voice_id: "asteria" });
  });
});
