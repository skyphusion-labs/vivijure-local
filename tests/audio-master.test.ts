import { describe, it, expect } from "vitest";
import {
  coerceConfig,
  defaultConfig,
  buildMasterBody,
  parseContainerResult,
  masterOutputFromResult,
  passthroughOutput,
} from "../src/modules/cpu/audio-master-core.js";
import { checkManifest, checkInvokeResponse, checkHookOutput, allPass, failures } from "../src/modules/conformance.js";
import type { MasterInput } from "../src/modules/types.js";

const SAMPLE_INPUT: MasterInput = {
  film_id: "film_neon_01",
  audio_key: "renders/neon/audio/bed.wav",
  audio_url: "https://acct.r2.cloudflarestorage.com/vivijure/renders/neon/audio/bed.wav?sig=get",
  output_url: "https://acct.r2.cloudflarestorage.com/vivijure/renders/neon/audio/bed_mastered.wav?sig=put",
  output_key: "renders/neon/audio/bed_mastered.wav",
  seconds: 42,
};

describe("audio-master: coerceConfig", () => {
  it("returns sane defaults for an empty config", () => {
    const c = coerceConfig({});
    expect(c).toEqual(defaultConfig());
    expect(c.target_lufs).toBe(-14);
    expect(c.upscale).toBe(true);
    expect(c.format).toBe("wav");
  });

  it("clamps target_lufs into the [-24, -9] range and falls back on non-numbers", () => {
    expect(coerceConfig({ target_lufs: -16 }).target_lufs).toBe(-16);
    expect(coerceConfig({ target_lufs: -30 }).target_lufs).toBe(-24);
    expect(coerceConfig({ target_lufs: 0 }).target_lufs).toBe(-9);
    expect(coerceConfig({ target_lufs: "loud" }).target_lufs).toBe(-14);
  });

  it("honors the upscale toggle and rejects unknown formats", () => {
    expect(coerceConfig({ upscale: false }).upscale).toBe(false);
    expect(coerceConfig({ upscale: true }).upscale).toBe(true);
    expect(coerceConfig({ format: "mp3" }).format).toBe("mp3");
    expect(coerceConfig({ format: "flac" }).format).toBe("wav");
  });
});

describe("audio-master: buildMasterBody", () => {
  it("forwards presigned URLs + output_key with clamped knobs", () => {
    const body = buildMasterBody(SAMPLE_INPUT, coerceConfig({ target_lufs: -12, upscale: false, format: "mp3" }));
    expect(body.audioUrl).toBe(SAMPLE_INPUT.audio_url);
    expect(body.outputUrl).toBe(SAMPLE_INPUT.output_url);
    expect(body.outputKey).toBe(SAMPLE_INPUT.output_key);
    expect(body.targetLufs).toBe(-12);
    expect(body.upscale).toBe(false);
    expect(body.format).toBe("mp3");
  });
});

describe("audio-master: parseContainerResult", () => {
  it("extracts ok + facts from a well-formed result", () => {
    const r = parseContainerResult({
      ok: true,
      key: "renders/neon/audio/bed_mastered.wav",
      bytes: 1234,
      format: "wav",
      durationSeconds: 42.0,
      lufs: -14.05,
      loudnessTargetLufs: -14,
      upscaled: true,
    });
    expect(r).toMatchObject({ ok: true, key: "renders/neon/audio/bed_mastered.wav", upscaled: true, loudnessTargetLufs: -14 });
  });
});

describe("audio-master: masterOutputFromResult", () => {
  it("tags music-upscale + loudnorm when the container upscaled", () => {
    const out = masterOutputFromResult(SAMPLE_INPUT, {
      ok: true,
      key: "renders/neon/audio/bed_mastered.wav",
      upscaled: true,
      loudnessTargetLufs: -14,
    });
    expect(out.audio_key).toBe("renders/neon/audio/bed_mastered.wav");
    expect(out.applied).toEqual(["music-upscale:soxr48k", "loudnorm:-14LUFS"]);
  });
});

describe("audio-master: manifest + output conformance", () => {
  const MANIFEST = {
    name: "audio-master",
    version: "0.1.0",
    api: "vivijure-module/2",
    hooks: ["master"],
    provides: [{ id: "master", label: "Master film audio (loudness + music upscale)" }],
    config_schema: {
      target_lufs: { type: "float", default: -14, min: -24, max: -9 },
      upscale: { type: "bool", default: true },
      format: { type: "enum", values: ["wav", "mp3"], default: "wav" },
    },
  };
  it("passes the conformance manifest checker", () => {
    const checks = checkManifest(MANIFEST);
    expect(allPass(checks), JSON.stringify(failures(checks))).toBe(true);
  });
  it("invoke success / degraded responses pass the response checker", () => {
    expect(checkInvokeResponse({ ok: true, output: { audio_key: "k_mastered.wav", applied: ["loudnorm:-14LUFS"] } }).pass).toBe(true);
    expect(checkInvokeResponse({ ok: true, output: passthroughOutput(SAMPLE_INPUT, "no-vpc-binding") }).pass).toBe(true);
    expect(checkHookOutput("master", passthroughOutput(SAMPLE_INPUT, "no-vpc-binding")).pass).toBe(true);
  });
});

describe("audio-master: passthroughOutput", () => {
  it("carries the INPUT bed through unchanged", () => {
    const o = passthroughOutput(SAMPLE_INPUT, "container-failed");
    expect(o.audio_key).toBe(SAMPLE_INPUT.audio_key);
    expect(o.applied).toEqual(["passthrough:container-failed"]);
    expect(o.degraded).toBe("container-failed");
  });
});
