// local#526: adopting vivijure-core 1.43.0 from 1.26.0. Two host contracts changed under local without a
// test noticing, and these pin them against the manifests local actually SERVES (dev/manifests/*.json are
// read by scripts/score-module-server.ts, scripts/cpu-module-server.ts and scripts/runpod-module-server.ts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickScoreModule, undeclaredScoreModules } from "@skyphusion-labs/vivijure-core/modules/score-select";
import { beatSyncScoreModules } from "@skyphusion-labs/vivijure-core/beat-analyze";
import { parseMotionUsage } from "@skyphusion-labs/vivijure-core/motion-usage";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core/modules/types";
import { ConfigValueError } from "@skyphusion-labs/vivijure-core/modules/registry";
import { BoardKeyCollisionError } from "@skyphusion-labs/vivijure-core/storyboard-projects-db";
import { FilmBusyError, FilmNotStartedError } from "@skyphusion-labs/vivijure-core/film-orchestrator";
import { coreRefusal, httpErrorResponse } from "../src/errors.js";

const SRC = join(import.meta.dirname, "..", "src");

const DIR = join(import.meta.dirname, "..", "dev", "manifests");
const served = (name: string): RegisteredModule =>
  ({ ...JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")), binding: `MODULE_${name.toUpperCase().replace(/-/g, "_")}` }) as RegisteredModule;

describe("core#471 (core 1.38.0): a score module is selected only by its declared score_kind", () => {
  // Before this the three fixtures declared no kind, so core 1.38+ selected none of them: a local film
  // got no score bed and no beat sync, silently. One test (beat-sync.test.ts) caught one symptom.
  const SCORE = [served("beat-sync"), served("music-gen"), served("narration-gen")];

  it("CONTROL: these are the served fixtures, and each serves the score hook", () => {
    expect(SCORE.map((m) => m.name)).toEqual(["beat-sync", "music-gen", "narration-gen"]);
    for (const m of SCORE) expect(m.hooks).toContain("score");
  });

  for (const [kind, name] of [["beat", "beat-sync"], ["music", "music-gen"], ["narration", "narration-gen"]] as const) {
    it(`core 1.43 picks ${name} for ${kind}`, () => {
      const pick = pickScoreModule(SCORE, kind);
      expect(pick.ok && pick.module.name).toBe(name);
    });
  }

  it("beat analysis finds beat-sync, and no served score module is undeclared", () => {
    expect(beatSyncScoreModules(SCORE).map((m) => m.name)).toEqual(["beat-sync"]);
    expect(undeclaredScoreModules(SCORE)).toEqual([]);
  });
});

describe("core#466 (core 1.37.0): a spoken line is padded only to the floor the door declares", () => {
  it("alibaba-wan declares its 3 s driving-audio floor, read the way core reads it", () => {
    // Wan takes driving audio of 3 to 30 s. Without the floor core sends a shorter line unpadded.
    expect(parseMotionUsage(served("alibaba-wan").usage)?.driving_audio_min_seconds).toBe(3);
  });
});

describe("core refusals answer as client errors, never 500 (local#520, local#525)", () => {
  const cases: [string, unknown, number][] = [
    ["ConfigValueError (core#343, PR core#517)", new ConfigValueError("size", "1080p", ["480p", "720p"]), 400],
    ["BoardKeyCollisionError (core#518, PR core#519)", new BoardKeyCollisionError("t", { id: "p1", name: "A", title: "t" } as never), 409],
    ["FilmBusyError (core#448)", new FilmBusyError("film-1"), 409],
    ["FilmNotStartedError (core#422)", new FilmNotStartedError("door down"), 503],
  ];
  for (const [label, err, status] of cases) {
    it(`${label} is ${status} with core's message`, async () => {
      const res = httpErrorResponse(err)!;
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toBe((err as Error).message);
    });
  }
  it("CONTROL: anything else is not a refusal, so it stays a 500", () => {
    expect(coreRefusal(new Error("boom"))).toBeNull();
    expect(httpErrorResponse(new Error("boom"))).toBeNull();
  });
});

describe("core#339 (PR core#510, core 1.42.0): every mint from a resolved bag forwards the dialogue choice", () => {
  // Parity with vivijure-cf#1379. A site that passes mapped.finish_config into a mint must pass the
  // dialogue fields from the same mapping, or the caller's dialogue config never reaches the film.
  const FILES = ["routes/m5.ts", "finalize-from-keyframes.ts"];
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  it("each such site passes dialogue_backend and dialogue_config", () => {
    let mints = 0;
    for (const f of FILES) {
      const s = readFileSync(join(SRC, f), "utf8");
      const n = count(s, /(?<![_A-Za-z])finish_config: mapped\.finish_config/g);
      mints += n;
      expect(count(s, /dialogue_backend: mapped\.dialogue_backend/g), f).toBe(n);
      expect(count(s, /dialogue_config: mapped\.dialogue_config/g), f).toBe(n);
    }
    expect(mints).toBe(3); // DENOMINATOR: panel render, render from keyframes, finalize
  });
});
