import { describe, it, expect } from "vitest";
import {
  MODEL,
  buildMusicParams,
  parseAudioUrl,
  encodePoll,
  decodePoll,
  stateKey,
  audioKey,
  appliedTags,
  readOutput,
  normalizeConfig,
  mimeForFormat,
  promptFromScoreInput,
} from "../src/modules/score/music-gen-core.js";

describe("music-gen pure logic", () => {
  it("buildMusicParams includes required MiniMax fields with defaults", () => {
    expect(buildMusicParams("cinematic strings", {})).toEqual({
      prompt: "cinematic strings",
      is_instrumental: false,
      lyrics_optimizer: false,
      format: "mp3",
      bitrate: 128000,
      sample_rate: 44100,
      lyrics: "[Instrumental]",
    });
  });

  it("buildMusicParams forwards config lyrics and knobs", () => {
    expect(
      buildMusicParams("ballad", {
        lyrics: "[Verse]\nhello",
        is_instrumental: false,
        lyrics_optimizer: false,
        format: "wav",
        bitrate: 256000,
        sample_rate: 32000,
      }),
    ).toEqual({
      prompt: "ballad",
      is_instrumental: false,
      lyrics_optimizer: false,
      format: "wav",
      bitrate: 256000,
      sample_rate: 32000,
      lyrics: "[Verse]\nhello",
    });
  });

  it("buildMusicParams omits lyrics when lyrics_optimizer is on", () => {
    const p = buildMusicParams("pop", { lyrics_optimizer: true });
    expect(p.lyrics).toBeUndefined();
    expect(p.lyrics_optimizer).toBe(true);
  });

  it("promptFromScoreInput prefers config.prompt, then storyboard", () => {
    expect(
      promptFromScoreInput(
        { film_key: "films/x.mp4", seconds: 30, storyboard: { scenes: [{ prompt: "neon alley" }] } },
        { prompt: "custom score" },
      ),
    ).toBe("custom score");
    expect(
      promptFromScoreInput(
        {
          film_key: "films/x.mp4",
          seconds: 30,
          storyboard: { title: "Neon Rain", scenes: [{ prompt: "neon alley" }] },
        },
        {},
      ),
    ).toContain("Neon Rain");
    expect(
      promptFromScoreInput(
        { film_key: "films/x.mp4", seconds: 30, storyboard: { scenes: [{ prompt: "desert highway" }] } },
        {},
      ),
    ).toContain("desert highway");
  });

  it("promptFromScoreInput rejects empty context", () => {
    expect(() => promptFromScoreInput({ film_key: "x", seconds: 1 }, {})).toThrow(/prompt required/);
  });

  it("parseAudioUrl reads flat and nested audio URLs", () => {
    expect(parseAudioUrl({ audio: "https://cdn/a.mp3" })).toBe("https://cdn/a.mp3");
    expect(parseAudioUrl({ result: { audio: "https://cdn/b.mp3" } })).toBe("https://cdn/b.mp3");
    expect(parseAudioUrl({ state: "Running" })).toBeNull();
  });

  it("poll token + state keys round-trip", () => {
    expect(decodePoll(encodePoll({ job_id: "abc-123" }))).toEqual({ job_id: "abc-123" });
    expect(stateKey("abc-123")).toBe("music-gen/abc-123.state.json");
    expect(audioKey("abc-123", "mp3")).toBe("out/abc-123.mp3");
  });

  it("readOutput returns ScoreOutput with film_key + applied", () => {
    const applied = appliedTags("mp3", { is_instrumental: true });
    const out = readOutput({
      status: "done",
      film_key: "films/silent.mp4",
      audio_key: "out/x.mp3",
      mime: "audio/mpeg",
      applied: [...applied, "audio:out/x.mp3"],
    });
    expect(out).toEqual({ film_key: "films/silent.mp4", applied: [...applied, "audio:out/x.mp3"] });
    expect(applied).toContain(`music:${MODEL}`);
  });

  it("normalizeConfig + mimeForFormat", () => {
    expect(normalizeConfig({ format: "wav", bitrate: "256000" })).toMatchObject({
      format: "wav",
      bitrate: 256000,
    });
    expect(mimeForFormat("wav")).toBe("audio/wav");
    expect(mimeForFormat("mp3")).toBe("audio/mpeg");
  });
});
