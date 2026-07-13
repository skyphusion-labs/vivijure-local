import { describe, it, expect } from "vitest";
import { resolveRunpodEndpointId, runpodConfigured } from "../src/modules/runpod/env.js";

describe("resolveRunpodEndpointId", () => {
  const base = {
    RUNPOD_API_KEY: "rp-key",
    RUNPOD_ENDPOINT_ID: "ep-default",
    BACKEND_RUNPOD_ENDPOINT_ID: "ep-wan",
    KEYFRAME_RUNPOD_ENDPOINT_ID: "ep-sdxl",
    VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID: "ep-upscale",
    MUSETALK_RUNPOD_ENDPOINT_ID: "ep-muse",
  };

  it("own-gpu uses BACKEND_RUNPOD_ENDPOINT_ID, not the keyframe default", () => {
    expect(resolveRunpodEndpointId("own-gpu", base)).toBe("ep-wan");
  });

  it("keyframe uses KEYFRAME_RUNPOD_ENDPOINT_ID when set", () => {
    expect(resolveRunpodEndpointId("keyframe", base)).toBe("ep-sdxl");
  });

  it("finish-rife shares the Wan backend endpoint", () => {
    expect(resolveRunpodEndpointId("finish-rife", base)).toBe("ep-wan");
  });

  it("falls back to RUNPOD_ENDPOINT_ID when per-module override absent", () => {
    const env = { RUNPOD_ENDPOINT_ID: "ep-only", RUNPOD_API_KEY: "k" };
    expect(resolveRunpodEndpointId("own-gpu", env)).toBe("ep-only");
    expect(resolveRunpodEndpointId("keyframe", env)).toBe("ep-only");
  });

  it("runpodConfigured respects per-module endpoint resolution", () => {
    expect(runpodConfigured({ RUNPOD_API_KEY: "k", BACKEND_RUNPOD_ENDPOINT_ID: "ep-wan" }, "own-gpu")).toBe(true);
    expect(runpodConfigured({ RUNPOD_API_KEY: "k" }, "own-gpu")).toBe(false);
  });
});
