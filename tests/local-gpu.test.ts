import { describe, expect, it } from "vitest";

import {
  buildI2vBody,
  decodePoll,
  encodePoll,
  framesFor,
  isSafeJobId,
  normalizeBackendUrl,
} from "../src/modules/local-gpu/i2v-core.js";
import {
  buildPreviewBody,
  decodeKeyframePoll,
  encodeKeyframePoll,
  parseKeyframes,
} from "../src/modules/local-gpu/keyframe-core.js";

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

describe("local-gpu keyframe preview mapping (#153)", () => {
  it("builds action:preview for the local door", () => {
    const body = buildPreviewBody(
      { project: "film", bundle_key: "bundles/film.tar.gz", shot_ids: ["shot_01"] },
      { quality_tier: "draft", width: 1024, height: 576 },
    );
    expect(body.input).toMatchObject({
      action: "preview",
      project: "film",
      bundle_key: "bundles/film.tar.gz",
      quality_tier: "draft",
      process_shot_ids: ["shot_01"],
      render_overrides: { keyframe: { width: 1024, height: 576 } },
    });
  });

  it("parses keyframe keys from door output", () => {
    expect(
      parseKeyframes({
        project: "film",
        keyframes: [{ shot_id: "shot_01", key: "renders/film/keyframes/shot_01.png" }],
      }),
    ).toEqual([{ shot_id: "shot_01", keyframe_key: "renders/film/keyframes/shot_01.png" }]);
  });
});

describe("local-gpu poll token + URL hardening (#153 audit)", () => {
  it("accepts uuid-like job ids and rejects path payloads", () => {
    expect(isSafeJobId("a".repeat(32))).toBe(true);
    expect(isSafeJobId("../etc")).toBe(false);
    expect(isSafeJobId("id/../x")).toBe(false);
    expect(isSafeJobId("id?x=1")).toBe(false);
  });

  it("normalizes http(s) backend URLs and rejects schemes/userinfo", () => {
    expect(normalizeBackendUrl("https://door.local:8080/")).toBe("https://door.local:8080");
    expect(normalizeBackendUrl("http://10.0.0.2:8000")).toBe("http://10.0.0.2:8000");
    expect(normalizeBackendUrl("http://192.168.1.10:8000")).toBe("http://192.168.1.10:8000");
    expect(normalizeBackendUrl("http://172.16.0.10:8000")).toBe("http://172.16.0.10:8000");
    expect(normalizeBackendUrl("http://vivijure-local-16gb:8000")).toBe("http://vivijure-local-16gb:8000");
    expect(normalizeBackendUrl("ftp://door.local")).toBeNull();
    expect(normalizeBackendUrl("https://user:pass@door.local")).toBeNull();
    expect(normalizeBackendUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(normalizeBackendUrl("http://169.254.170.2/creds")).toBeNull();
    expect(normalizeBackendUrl("http://metadata.google.internal/computeMetadata/v1")).toBeNull();
  });

  it("scopes motion vs keyframe poll tokens", () => {
    const motion = encodePoll({
      jobId: "abc123",
      shotId: "shot_01",
      submittedAt: 1,
    });
    const keyframe = encodeKeyframePoll({
      jobId: "abc123",
      project: "film",
      submittedAt: 1,
      kind: "keyframe",
    });
    expect(decodePoll(motion)?.jobId).toBe("abc123");
    expect(decodeKeyframePoll(motion)).toBeNull();
    expect(decodeKeyframePoll(keyframe)?.kind).toBe("keyframe");
    expect(decodePoll(keyframe)).toBeNull();
    const unknownKind = Buffer.from(
      JSON.stringify({ jobId: "abc123", shotId: "shot_01", kind: "motion" }),
      "utf8",
    ).toString("base64");
    expect(decodePoll(unknownKind)).toBeNull();
  });

  it("omits project from motion poll tokens while still accepting legacy project-bearing tokens", () => {
    const motion = encodePoll({
      jobId: "abc123",
      project: "film",
      shotId: "shot_01",
      submittedAt: 1,
    });
    expect(JSON.parse(Buffer.from(motion, "base64").toString("utf8"))).toEqual({
      jobId: "abc123",
      shotId: "shot_01",
      submittedAt: 1,
    });
    const legacy = Buffer.from(
      JSON.stringify({ jobId: "abc123", project: "film", shotId: "shot_01", submittedAt: 1 }),
      "utf8",
    ).toString("base64");
    expect(decodePoll(legacy)).toEqual({
      jobId: "abc123",
      project: "film",
      shotId: "shot_01",
      submittedAt: 1,
    });
  });
});
