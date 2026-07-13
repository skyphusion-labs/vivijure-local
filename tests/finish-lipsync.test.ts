import { describe, it, expect } from "vitest";
import type { FinishOutput } from "@skyphusion-labs/vivijure-core";
import {
  buildLipsyncBody,
  coerceLipsyncConfig,
  lipsyncedKey,
  passthroughOutput,
} from "../src/modules/runpod/finish-core.js";
import { invokeRunpodModule } from "../src/modules/runpod/handlers.js";

describe("finish-lipsync core", () => {
  it("lipsyncedKey appends _ls before the extension", () => {
    expect(lipsyncedKey("renders/p/clips/shot_01.mp4")).toBe("renders/p/clips/shot_01_ls.mp4");
  });

  it("buildLipsyncBody forwards clip, audio, and config to MuseTalk", () => {
    const body = buildLipsyncBody(
      {
        shot_id: "shot_01",
        clip_key: "renders/p/clips/shot_01.mp4",
        audio_key: "renders/p/audio/shot_01.wav",
        src_fps: 24,
        frames: 48,
        width: 512,
        height: 512,
      },
      coerceLipsyncConfig({ version: "v15", bbox_shift: 2 }),
    );
    expect(body.input).toEqual({
      clip_key: "renders/p/clips/shot_01.mp4",
      audio_key: "renders/p/audio/shot_01.wav",
      output_key: "renders/p/clips/shot_01_ls.mp4",
      version: "v15",
      bbox_shift: 2,
    });
  });

  it("passthroughOutput tags intentional no-op separately from degrade", () => {
    const noop = passthroughOutput(
      { shot_id: "shot_01", clip_key: "renders/p/clips/shot_01.mp4", src_fps: 24, frames: 48, width: 0, height: 0 },
      "no-dialogue",
      { degraded: false },
    );
    expect(noop.applied).toEqual(["noop:no-dialogue"]);
    expect(noop.degraded).toBeUndefined();
  });
});

describe("finish-lipsync invoke", () => {
  it("no-ops silently when a shot has no dialogue audio_key", async () => {
    const r = await invokeRunpodModule(
      { RUNPOD_API_KEY: "k", MUSETALK_RUNPOD_ENDPOINT_ID: "ep" },
      "finish-lipsync",
      {
        hook: "finish",
        input: {
          shot_id: "shot_01",
          clip_key: "renders/p/clips/shot_01.mp4",
          src_fps: 24,
          frames: 48,
          width: 512,
          height: 512,
        },
        config: {},
        context: { project: "p", job_id: "film-1" },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      const out = r.output as FinishOutput;
      expect(out.applied).toEqual(["noop:no-dialogue"]);
      expect(out.clip_key).toBe("renders/p/clips/shot_01.mp4");
    }
  });
});
