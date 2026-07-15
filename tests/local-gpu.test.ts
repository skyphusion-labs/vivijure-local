import { describe, expect, it } from "vitest";

import { buildI2vBody, framesFor } from "../src/modules/local-gpu/i2v-core.js";

describe("local-gpu i2v mapping", () => {
  it("keeps duration-derived frames for flexible doors", () => {
    expect(framesFor(5, 24)).toBe(120);
    const body = buildI2vBody(
      { shot_id: "shot_01", keyframe_url: "https://example.test/kf.png", prompt: "slow push", seconds: 5 },
      { quality: "standard", fps: 24 },
      "film",
    );
    expect(body.input.config).toMatchObject({ quality: "standard", num_frames: 120, fps: 24 });
  });

  it("honors a fixed door grid instead of deriving corrupt off-grid frames", () => {
    const grid = {
      fps: 8,
      tiers: { draft: { max_frames: 49 }, standard: { max_frames: 49 }, final: { max_frames: 49 } },
    };
    const body = buildI2vBody(
      { shot_id: "shot_01", keyframe_url: "https://example.test/kf.png", prompt: "slow push", seconds: 5 },
      { quality: "standard", fps: 24 },
      "film",
      grid,
    );
    expect(body.input.config).toMatchObject({ quality: "standard", num_frames: 49, fps: 8 });
  });
});
