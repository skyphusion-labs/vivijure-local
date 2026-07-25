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

  it("carries the reason VERBATIM, identical to the hosted panel", () => {
    // The text IS the product here: it is printed unmodified to someone who may not be able to fix
    // it. Pinned so a later tidy-up toward operator jargon cannot silently regress it, and pinned
    // IDENTICALLY on both panels so a self-hoster and a tenant read the same sentence.
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).toBe(
      "Video finishing is not yet provisioned for this studio; finished renders deliver as per-shot clips.",
    );
    for (const hook of VIDEO_FINISH_GATED_HOOKS) {
      expect(videoFinishHooksUnavailable({})[hook]).toBe(VIDEO_FINISH_UNAVAILABLE_REASON);
    }
  });
});
