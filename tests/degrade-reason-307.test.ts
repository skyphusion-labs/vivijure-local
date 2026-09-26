// local#307 unit half: the degrade reason is read STRUCTURALLY, never as prose.
//
// Separate from tests/runpod-degrade-outcome-307.test.ts on purpose: that file proves what gets
// RECORDED and is written to load against pre-fix source so it can be driven red. This file tests the
// new reason channel itself, so it cannot exist before the fix and makes no red-first claim.
import { describe, expect, it } from "vitest";
import { degradeFaultFromEnvelope } from "../src/platform/modules.js";
import { DEGRADE_DETAIL_SEP, degradeReasonOf, formatDegrade } from "../src/degrade-reason.js";

describe("the reason channel is read structurally, never as prose (local#307)", () => {
  it("degradeFaultFromEnvelope maps only the three RunPod faults", () => {
    const fault = (degraded: unknown) => degradeFaultFromEnvelope({ ok: true, output: { degraded } });
    expect(fault("endpoint-gone")?.outcome).toBe("gone");
    expect(fault("endpoint-failed: HTTP 500")?.outcome).toBe("failed");
    expect(fault("endpoint-error: boom")?.outcome).toBe("backend-error");
    // Not RunPod faults: every one of these keeps completed.
    expect(fault("no-output-key")).toBeNull();
    expect(fault("local-door-unconfigured-mid-job")).toBeNull();
    expect(fault("disabled")).toBeNull();
    expect(fault(undefined)).toBeNull();
  });

  it("does not widen on a hostile or malformed envelope", () => {
    expect(degradeFaultFromEnvelope({ ok: true })).toBeNull();
    expect(degradeFaultFromEnvelope({ ok: true, output: null })).toBeNull();
    expect(degradeFaultFromEnvelope({ ok: true, output: "endpoint-gone" })).toBeNull();
    expect(degradeFaultFromEnvelope({ ok: true, output: { degraded: 42 } })).toBeNull();
    expect(degradeFaultFromEnvelope({ ok: true, output: { degraded: "" } })).toBeNull();
    // A reason that merely CONTAINS a fault token is not that fault: the token is the head segment.
    expect(degradeFaultFromEnvelope({ ok: true, output: { degraded: "not-endpoint-gone" } })).toBeNull();
    // `error` prose is never a channel, even when it names the fault in words.
    expect(degradeFaultFromEnvelope({ ok: true, output: {}, error: "endpoint-gone" })).toBeNull();
  });

  it("format and read are inverses, and a detail containing the separator is harmless", () => {
    expect(degradeReasonOf(formatDegrade("endpoint-failed"))).toBe("endpoint-failed");
    expect(degradeReasonOf(formatDegrade("endpoint-failed", ""))).toBe("endpoint-failed");
    const blob = JSON.stringify({ error: { detail: "a: b" } });
    expect(degradeReasonOf(formatDegrade("endpoint-error", blob))).toBe("endpoint-error");
    expect(formatDegrade("endpoint-error", blob)).toContain(DEGRADE_DETAIL_SEP);
  });

  it("no mapped reason literal contains the separator (the split stays unambiguous)", () => {
    for (const reason of ["endpoint-gone", "endpoint-failed", "endpoint-error", "no-output-key"]) {
      expect(reason.includes(DEGRADE_DETAIL_SEP)).toBe(false);
    }
  });
});
