// local#568: the vendored cf-vidu-q3-turbo door must behave EXACTLY like vivijure-cf's module.
//
// This imports vivijure-cf's own modules/cf-vidu-q3-turbo/src/params.ts from the checkout CI already
// makes at the pinned SHA (dev/cf-quality-tier-pin; ci.yml and coverage.yml check it out beside this
// repo as ../vivijure). params.ts imports only ./contract, types only, so it loads under Node. The
// error strings live in index.ts, which imports cloudflare:workers and cannot load here, so those are
// compared as source text.
//
// Absent checkout: in CI that FAILS (the parity would otherwise pass by never running). Locally it is
// reported as "could not measure" and the suite is skipped, never passed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as local from "../src/modules/gateway-i2v/doors/cf-vidu-q3-turbo.js";
import { NOT_STORED_ERROR, NO_VIDEO_URL_ERROR } from "../src/modules/gateway-i2v/runner.js";

const ROOT = join(import.meta.dirname, "..");
const CANDIDATES = [process.env.VIVIJURE_SRC, join(ROOT, "..", "vivijure"), join(ROOT, "..", "vivijure-cf")].filter(
  (p): p is string => typeof p === "string" && p.length > 0,
);
const CF = CANDIDATES.find((p) => existsSync(join(p, "modules", "cf-vidu-q3-turbo", "src", "params.ts")));
const IN_CI = process.env.CI === "true";

describe("vivijure-cf checkout for the parity test (local#568)", () => {
  it(IN_CI ? "is present in CI" : "is present, or the parity suite reports could-not-measure", () => {
    if (!CF) {
      if (IN_CI) throw new Error(`local#568: no vivijure-cf checkout with cf-vidu-q3-turbo in ${CANDIDATES.join(", ")}`);
      console.warn(`local#568 parity: COULD NOT MEASURE (no vivijure-cf checkout in ${CANDIDATES.join(", ")})`);
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!CF)("cf-vidu-q3-turbo matches vivijure-cf (local#568)", async () => {
  const cf = CF ? await import(join(CF, "modules", "cf-vidu-q3-turbo", "src", "params.ts")) : ({} as never);
  const cfIndex = CF ? readFileSync(join(CF, "modules", "cf-vidu-q3-turbo", "src", "index.ts"), "utf8") : "";
  const cfPaid = CF ? readFileSync(join(CF, "modules", "_shared", "paid-generation.ts"), "utf8") : "";

  it("constants", () => {
    for (const k of ["MODEL", "OUT_FPS", "MIN_DURATION", "MAX_DURATION", "DEFAULT_DURATION", "PROMPT_MAX", "RESOLUTIONS", "DEFAULT_RESOLUTION"]) {
      expect((local as Record<string, unknown>)[k], k).toEqual(cf[k]);
    }
  });

  it.each([NaN, 0, 0.4, 1, 4.6, 16, 16.4, 17, -3, "6" as unknown as number, undefined as unknown as number])(
    "clampDuration(%s)",
    (s) => expect(local.clampDuration(s)).toBe(cf.clampDuration(s)),
  );

  it.each([
    {},
    { resolution: "540p" },
    { resolution: "1080p", generate_audio: false },
    { resolution: "4k" },
    { resolution: 720 },
    { generate_audio: "no" },
    { generate_audio: true },
  ])("normalizeConfig(%j)", (raw) => expect(local.normalizeConfig(raw)).toEqual(cf.normalizeConfig(raw)));

  const base = { shot_id: "s1", keyframe_url: "https://x.example/k.png", prompt: "a lighthouse", seconds: 5 };
  it.each([
    [base, {}],
    [{ ...base, last_keyframe_url: "https://x.example/e.png" }, { resolution: "1080p" }],
    [{ ...base, prompt: "p".repeat(6000), seconds: 40 }, { generate_audio: false }],
    [{ ...base, prompt: "", seconds: 0 }, { resolution: "540p" }],
  ])("buildParams case %#", (input, raw) => {
    expect(local.buildParams(input as never, local.normalizeConfig(raw))).toEqual(cf.buildParams(input, cf.normalizeConfig(raw)));
  });

  it.each([
    { video: "https://v/1.mp4" },
    { result: { video: "https://v/2.mp4" } },
    { state: "Completed", video: "https://v/3.mp4" },
    { state: "Processing", video: "https://v/4.mp4" },
    { result: ["nope"] },
    { video: "" },
    null,
    "https://v/5.mp4",
    42,
  ])("parseVideoUrl(%j)", (raw) => expect(local.parseVideoUrl(raw)).toBe(cf.parseVideoUrl(raw)));

  it("state and clip keys", () => {
    for (const [p, s] of [["proj", "s1"], ["my project!", "shot/2"], ["", ""]]) {
      expect(local.clipKey(p, s)).toBe(cf.clipKey(p, s));
    }
    expect(local.stateKey("job-1-s1")).toBe(cf.stateKey("job-1-s1"));
  });

  it("the runner's errors are cf's, verbatim", () => {
    for (const s of [
      "motion.backend: input needs shot_id, keyframe_url, and prompt",
      'reason: "bad-input"',
      'reason: "not-configured"',
      'reason: "unsupported"',
      "could not persist run state: ",
      "bad poll token",
      "run state not found (expired or bad token)",
      "invalid JSON body",
      "unsupported hook ",
      "poll token required",
      '"generation failed"',
      "generation workflow ",
    ]) {
      expect(cfIndex, s).toContain(s);
    }
    expect(cfPaid).toContain(JSON.stringify(NOT_STORED_ERROR));
    expect(cfPaid).toContain(JSON.stringify(NO_VIDEO_URL_ERROR));
    // The one named difference: cf needs a GATEWAY_ID binding; this host needs three creds and says so.
    expect(cfIndex).toContain("GATEWAY_ID not configured");
  });

  it("the synced manifest is cf's MANIFEST name and version", () => {
    const m = JSON.parse(readFileSync(join(ROOT, "dev", "manifests", "cf-vidu-q3-turbo.json"), "utf8")) as { name: string; version: string };
    expect(cfIndex).toContain(`name: "${m.name}"`);
    expect(cfIndex).toContain(`version: "${m.version}"`);
  });
});
