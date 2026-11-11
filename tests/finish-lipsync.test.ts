import { describe, it, expect } from "vitest";
import type { FinishOutput } from "@skyphusion-labs/vivijure-core";
import {
  buildFinishBody,
  buildLipsyncBody,
  coerceFinishConfig,
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
      "p",
    );
    expect(body.input).toEqual({
      project: "p",
      clip_key: "renders/p/clips/shot_01.mp4",
      audio_key: "renders/p/audio/shot_01.wav",
      output_key: "renders/p/clips/shot_01_ls.mp4",
      version: "v15",
      bbox_shift: 2,
    });
  });

  it("local#529: the film's output_key wins over the shared _ls key; two films never share one", () => {
    const base = {
      shot_id: "shot_01", clip_key: "renders/p/clips/shot_01_bk.mp4", audio_key: "renders/p/audio/shot_01.wav",
      src_fps: 24, frames: 48, width: 512, height: 512,
    };
    const cfg = coerceLipsyncConfig({});
    const a = buildLipsyncBody({ ...base, output_key: "renders/p/clips/film-a/shot_01_bk_ls.mp4" }, cfg, "p");
    const b = buildLipsyncBody({ ...base, output_key: "renders/p/clips/film-b/shot_01_bk_ls.mp4" }, cfg, "p");
    expect(a.input.output_key).toBe("renders/p/clips/film-a/shot_01_bk_ls.mp4");
    expect(b.input.output_key).toBe("renders/p/clips/film-b/shot_01_bk_ls.mp4");
    // CONTROL: with no output_key (an older core) it is the shared key, as before.
    expect(buildLipsyncBody(base, cfg, "p").input.output_key).toBe("renders/p/clips/shot_01_bk_ls.mp4");
  });

  it("local#529: the upscale and finish bodies forward output_key when core sends one, and omit it otherwise", () => {
    const base = { shot_id: "s1", clip_key: "renders/p/clips/s1_bk.mp4", src_fps: 24, frames: 48, width: 512, height: 512 };
    const cfg = coerceFinishConfig({});
    for (const action of ["upscale_clip", "finish_clip", "lipsync_clip"] as const) {
      const withKey = buildFinishBody({ ...base, output_key: "renders/p/clips/film-a/s1_bk_up.mp4" }, cfg, "p", action);
      expect(withKey.input.output_key, action).toBe("renders/p/clips/film-a/s1_bk_up.mp4");
      expect("output_key" in buildFinishBody(base, cfg, "p", action).input, action).toBe(false);
    }
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
  it("no-ops when a shot has no dialogue audio_key", async () => {
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

  it("fail-loud when RunPod creds are missing", async () => {
    const r = await invokeRunpodModule({}, "finish-lipsync", {
      hook: "finish",
      input: {
        shot_id: "shot_01",
        clip_key: "renders/p/clips/shot_01.mp4",
        audio_key: "renders/p/audio/shot_01.wav",
        src_fps: 24,
        frames: 48,
        width: 512,
        height: 512,
      },
      config: {},
      context: { project: "p", job_id: "film-1" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not configured/i);
  });
});

describe("finish-rife invoke", () => {
  it("fail-loud when RunPod creds are missing", async () => {
    const r = await invokeRunpodModule({}, "finish-rife", {
      hook: "finish",
      input: {
        shot_id: "shot_01",
        clip_key: "renders/p/clips/shot_01.mp4",
        src_fps: 24,
        frames: 48,
        width: 512,
        height: 512,
      },
      config: { interpolate: true },
      context: { project: "p", job_id: "film-1" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not configured/i);
  });
});
