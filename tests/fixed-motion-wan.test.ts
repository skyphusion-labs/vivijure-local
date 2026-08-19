import { describe, expect, it } from "vitest";
import { FIXED_MOTION } from "../src/modules/runpod/fixed-motion.js";

const wan = FIXED_MOTION["alibaba-wan"];

describe("alibaba-wan fixed-motion buildBody", () => {
  const input = {
    shot_id: "shot_01",
    keyframe_url: "https://studio.example/api/artifact/uploads%2Fkf.jpg?token=t",
    prompt: "ocean sunset horizon",
    seconds: 4,
  };

  it("maps shot_type single, size from config, and Wan duration enum", () => {
    const body = wan.buildBody(input, { resolution: "480p", shot_type: "single" });
    expect(body).toMatchObject({
      prompt: input.prompt,
      image: input.keyframe_url,
      negative_prompt: "",
      size: "480p",
      duration: 5,
      shot_type: "single",
      seed: -1,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
    });
  });

  it("snaps duration up to {5,10,15} never shorter than shot seconds", () => {
    expect(wan.buildBody({ ...input, seconds: 5 }, {}).duration).toBe(5);
    expect(wan.buildBody({ ...input, seconds: 4 }, {}).duration).toBe(5);
    expect(wan.buildBody({ ...input, seconds: 7.6 }, {}).duration).toBe(10);
    expect(wan.buildBody({ ...input, seconds: 99 }, {}).duration).toBe(15);
  });

  it("defaults size to 720p and shot_type to single when config omits them", () => {
    const body = wan.buildBody({ ...input, seconds: 5 }, {});
    expect(body.size).toBe("720p");
    expect(body.shot_type).toBe("single");
  });

  it("uses _wan clip suffix for stored clip keys", () => {
    expect(wan.clipSuffix).toBe("_wan");
  });

  it("sends the shot LINE as audio, never the Cast sample", () => {
    const withLine = wan.buildBody(
      { ...input, audio_url: "https://studio.example/api/artifact/dialogue%2Fshot_01.wav?token=t" },
      {},
    );
    expect(withLine.audio).toBe("https://studio.example/api/artifact/dialogue%2Fshot_01.wav?token=t");
    const withSample = wan.buildBody(
      { ...input, voice_ref_url: "https://studio.example/api/artifact/casts%2Fsample.mp4?token=t" },
      {},
    );
    expect(withSample).not.toHaveProperty("audio");
    expect(JSON.stringify(withSample)).not.toContain("voice_ref");
  });
});
