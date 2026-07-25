// cf#118 PARITY (self-host panel): the host reports which hooks the video-finish tier takes with it.
//
// Same contract as vivijure-cf, and asserted here rather than assumed to follow, because the two
// panels share no runtime module: parity is a promise about behaviour, and a promise nothing checks
// is a comment. The pure-function tests below pin the SET and the REASON so a drift on either side
// fails on the side that drifted.
//
// BOTH DIRECTIONS, per cf#98: a host with the container configured must report NOTHING, which is
// the panel's positive control -- a negative-only suite over a capability that is absent everywhere
// passes without proving anything.
//
// PARITY IS THE SET AND THE BIAS, NOT THE BYTES (local#226). The reason string is deliberately
// different from the hosted panel's, so nothing here asserts cross-panel string identity.

import { describe, expect, it } from "vitest";
import {
  VIDEO_FINISH_GATED_HOOKS,
  VIDEO_FINISH_UNAVAILABLE_REASON,
  videoFinishHooksUnavailable,
} from "../src/video-finish-availability.js";

describe("videoFinishHooksUnavailable (self-host)", () => {
  it("names EXACTLY the hooks the execution paths take down, no more", () => {
    expect(Object.keys(videoFinishHooksUnavailable({})).sort()).toEqual([
      "film.finish",
      "master",
      "notify",
      "score",
    ]);
  });

  it("does NOT name the per-shot hooks: per-shot clips are what a container-less host delivers", () => {
    const named = Object.keys(videoFinishHooksUnavailable({}));
    for (const survives of ["keyframe", "motion.backend", "finish", "speech", "dialogue", "image.generate", "cast.image"]) {
      expect(named, `${survives} still works on a clips delivery`).not.toContain(survives);
    }
  });

  it("POSITIVE CONTROL: a host with the video-finish container configured reports nothing", () => {
    // vpc-transport synthesizes VIDEO_FINISH_VPC from VIDEO_FINISH_URL, so presence of the fetcher
    // IS the "can this host reach the tier" answer on this panel.
    expect(videoFinishHooksUnavailable({ VIDEO_FINISH_VPC: { fetch: async () => new Response("ok") } })).toEqual({});
  });

  it("the reason addresses THIS host's reader, with THIS host's knob (local#226)", () => {
    // WHAT THIS TEST USED TO DO, and why it was wrong: it pinned the string IDENTICAL to the hosted
    // panel's. That reads like parity and is the opposite of it -- local#226 exists precisely
    // because the same hook needs a different sentence per host, and an identity pin would have
    // FAILED the fix for the defect it was locking in. Parity is the hook SET and the
    // absent-key-means-available bias, never the bytes.
    //
    // Knob: the self-host reader owns the machine, so name the thing they can actually set.
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).toMatch(/VIDEO_FINISH_URL/);
    // Action: pinned ABSENT rather than merely unasserted. "Ask whoever operates this studio" is
    // correct on the hosted door and tells a homelabber to go ask themselves.
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).not.toMatch(/Ask whoever/);
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).not.toMatch(/not yet provisioned/);
    // ...and it still says what they DO get, so "unavailable" cannot read as "broken".
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).toMatch(/per-shot clips/);
    // Every gated hook carries it, unmodified.
    for (const hook of VIDEO_FINISH_GATED_HOOKS) {
      expect(videoFinishHooksUnavailable({})[hook]).toBe(VIDEO_FINISH_UNAVAILABLE_REASON);
    }
  });
});
