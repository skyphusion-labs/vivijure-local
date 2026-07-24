// local#202: pure Aura-1 narration helpers (the creds-free default tier). No network.
import { describe, it, expect } from "vitest";
import {
  AURA_MODEL,
  AURA_SPEAKERS,
  DEFAULT_AURA_SPEAKER,
  NARRATION_HONEST_LABEL,
  NARRATION_TIERS,
  auraSpeakerFor,
  buildAuraParams,
  narrationAuraDegrade,
  narrationEngineFor,
  narrationFormat,
  narrationManifestView,
  narrationMime,
} from "../src/modules/score/narration-aura.js";

describe("auraSpeakerFor", () => {
  it("blank/undefined -> the default speaker", () => {
    expect(auraSpeakerFor(undefined)).toBe(DEFAULT_AURA_SPEAKER);
    expect(auraSpeakerFor("")).toBe(DEFAULT_AURA_SPEAKER);
    expect(auraSpeakerFor("   ")).toBe(DEFAULT_AURA_SPEAKER);
  });
  it("an explicit Aura speaker name passes through (case-insensitive)", () => {
    expect(auraSpeakerFor("luna")).toBe("luna");
    expect(auraSpeakerFor("ZEUS")).toBe("zeus");
  });
  it("is deterministic and always yields a real Aura speaker", () => {
    for (const v of ["Wise_Woman", "Deep_Male", "Narrator_A", "Kid_1", "x"]) {
      const a = auraSpeakerFor(v);
      expect(auraSpeakerFor(v)).toBe(a);
      expect(AURA_SPEAKERS as readonly string[]).toContain(a);
    }
  });
  it("keeps distinct cast voices distinct (spreads across the set)", () => {
    const voices = ["Wise_Woman", "Deep_Male", "Narrator_A", "Kid_1", "Villain", "Hero"];
    const speakers = new Set(voices.map(auraSpeakerFor));
    expect(speakers.size).toBeGreaterThanOrEqual(2);
  });
});

describe("buildAuraParams", () => {
  it("mp3 / flac use the codec directly", () => {
    expect(buildAuraParams("hi", "luna", "mp3")).toEqual({ text: "hi", speaker: "luna", encoding: "mp3" });
    expect(buildAuraParams("hi", "luna", "flac")).toEqual({ text: "hi", speaker: "luna", encoding: "flac" });
  });
  it("wav = linear16 in a wav container", () => {
    expect(buildAuraParams("hi", "luna", "wav")).toEqual({
      text: "hi",
      speaker: "luna",
      encoding: "linear16",
      container: "wav",
      sample_rate: 44100,
    });
  });
  it("uses the AURA_MODEL id", () => {
    expect(AURA_MODEL).toBe("@cf/deepgram/aura-1");
  });
});

describe("narrationFormat / narrationMime", () => {
  it("normalizes format and maps mime", () => {
    expect(narrationFormat("wav")).toBe("wav");
    expect(narrationFormat("flac")).toBe("flac");
    expect(narrationFormat("bogus")).toBe("mp3");
    expect(narrationMime("mp3")).toBe("audio/mpeg");
    expect(narrationMime("wav")).toBe("audio/wav");
    expect(narrationMime("flac")).toBe("audio/flac");
  });
});

describe("narrationAuraDegrade (honest, never silent)", () => {
  it("no MiniMax-only knob set -> null (request maps cleanly)", () => {
    expect(narrationAuraDegrade({})).toBeNull();
    expect(narrationAuraDegrade({ emotion: "neutral", pitch: 0, speed: 1, volume: 1 })).toBeNull();
    expect(narrationAuraDegrade({ voice_id: "Wise_Woman", format: "mp3" })).toBeNull();
  });
  it("a deviating knob -> a note naming it", () => {
    expect(narrationAuraDegrade({ emotion: "happy" })).toContain("emotion");
    expect(narrationAuraDegrade({ speed: 1.5 })).toContain("speed");
    const both = narrationAuraDegrade({ pitch: 3, volume: 2 });
    expect(both).toContain("pitch");
    expect(both).toContain("volume");
  });
});

describe("narrationEngineFor", () => {
  it("RunPod key wins (HD tier); else CF gateway (Aura); else none", () => {
    expect(narrationEngineFor(true, true)).toBe("minimax-runpod");
    expect(narrationEngineFor(true, false)).toBe("minimax-runpod");
    expect(narrationEngineFor(false, true)).toBe("aura-1");
    expect(narrationEngineFor(false, false)).toBe("none");
  });
});

describe("narrationManifestView (engine-honest runtime projection)", () => {
  const manifest = { name: "narration-gen", provides: [{ id: "minimax-speech", label: "MiniMax Speech 02 HD (RunPod)" }] };
  it("overrides the picker label and adds tier fields WITHOUT mutating input", () => {
    const view = narrationManifestView(manifest, "aura-1");
    expect((view.provides as Array<{ label: string }>)[0].label).toBe(NARRATION_HONEST_LABEL);
    expect(view.narration_engine).toBe("aura-1");
    expect(view.narration_tiers).toEqual(NARRATION_TIERS);
    expect(manifest.provides[0].label).toBe("MiniMax Speech 02 HD (RunPod)");
  });
});
