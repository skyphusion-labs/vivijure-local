/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { degradeReason, pollOutcomeFromEnvelope } from "../src/platform/modules.js";

// local#307. `observe()` treated `ok: true` as a completion, so a terminal poll where the module
// caught a backend fault and passed the source through recorded as `completed` in runpod_job_log.
//
// WHY THAT MATTERS AND WHY THE RENDER BEING FINE IS NOT A DEFENCE: this table exists to measure
// backend outcomes. A fault-driven passthrough recorded as a completion undercounts precisely the
// population the table was built to count, and the undercount is invisible -- the row is present,
// well-formed, and wrong. A load test reading this table for a backend failure rate gets a
// flattering number with nothing indicating it is flattering.
//
// `passthroughOutput` defaults to `degraded ?? true`, so a degrade is that helper's DEFAULT shape.
// This was never an edge case.

describe("local#307 -- a degrade is not a completion", () => {
  it("CONTROL: the reader returns null on a clean terminal, so a non-null result means something", () => {
    expect(degradeReason({ ok: true, output: { shot_id: "s1", applied: ["upscale"] } })).toBeNull();
  });

  it("reads the reason STRUCTURALLY from output.degraded", () => {
    expect(
      degradeReason({ ok: true, output: { degraded: "runpod-fault: 502 from endpoint" } }),
    ).toBe("runpod-fault: 502 from endpoint");
  });

  it("a boolean true becomes a fixed marker, never an empty detail", () => {
    // An empty string here would be indistinguishable from "we did not look", which is the whole
    // failure mode this issue is about.
    expect(degradeReason({ ok: true, output: { degraded: true } })).toBe("degraded");
  });

  it("NON-DEFAULT PROBE: a passthrough:<reason> in `applied` is NOT enough on its own", () => {
    // `applied` is prose-adjacent and a noop also writes into it. Inferring a degrade from it would
    // mis-tag the honest noops (no-dialogue, nothing-enabled) that deliberately set degraded:false.
    expect(degradeReason({ ok: true, output: { applied: ["passthrough:no-dialogue"] } })).toBeNull();
  });

  it("an explicit degraded:false is a completion, not a degrade", () => {
    expect(degradeReason({ ok: true, output: { degraded: false, applied: ["noop:nothing-enabled"] } })).toBeNull();
  });

  it("a missing or non-object output cannot throw and reports no degrade", () => {
    expect(degradeReason({ ok: true })).toBeNull();
    expect(degradeReason({ ok: true, output: null })).toBeNull();
    expect(degradeReason({ ok: true, output: "done" })).toBeNull();
  });

  it("CONTROL: the fault path is untouched -- a non-ok terminal still classifies by envelope", () => {
    expect(pollOutcomeFromEnvelope({ ok: false, outcome: "backend-error" })).toBe("backend-error");
    expect(pollOutcomeFromEnvelope({ ok: false, runpodStatus: "CANCELLED" })).toBe("cancelled");
    expect(pollOutcomeFromEnvelope({ ok: false })).toBe("failed");
  });
});
