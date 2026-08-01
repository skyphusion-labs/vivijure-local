// THE FAULT CLASS SURVIVES THE ENVELOPE (cf#286, cf#288, cf#298; twin of vivijure-cf PR #304).
//
// WHY A SEPARATE TEST FILE FROM tests/runpod-job-log-294.test.ts. That file proves the WRITER cannot
// break a render. This one proves the PRODUCER exists at all, which is the thing this door could not
// take for granted: vivijure-cf writes its row inside the module, with the RunPod /status payload in
// hand, so the class is simply there. Here the STUDIO writes the row at the transport seam and sees
// only what a module RETURNS, so anything the envelope does not carry is unrecoverable downstream.
//
// migrations/0016 says the module poll "collapses every failure into {ok:false, error: prose} before
// the studio sees it" and that "no column downstream can recover it". That is exactly right about
// `backend-error` and `gone`, which really are indistinguishable once flattened. It is NOT right
// about the fault CLASS: src/modules/runpod/handlers.ts has `s.error` directly in hand, so the class
// was DISCARDED at the envelope, not destroyed at the source. Additive optional markers recover it,
// the same move local#301 used for `jobId`. These tests pin BOTH halves: the module emits the
// markers, and the studio reads them.
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRunpodErrorType, ERROR_TYPE_MAX, DETAIL_MAX } from "../src/runpod-job-log.js";
import { runpodTerminalFailure, runpodFaultMarkers } from "../src/modules/runpod/shared.js";
import { HttpModuleTransport, type ModuleJobEvent } from "../src/platform/modules.js";

// The real payload from a deliberate refusal against the prod backend endpoint during cf#278 phase 1
// (job 07f9e72b-cd0d-4012-8216-007b440dbd51-e1, finish_clip with no clip_key). Kept verbatim rather
// than paraphrased: the entire point of the column is that the classification must not depend on
// where in this blob the class happens to sit.
const MEASURED_REFUSAL_ERROR = JSON.stringify({
  error_type: "<class 'vivijure_backend.harness.handler.HarnessError'>",
  error_message: "finish_clip: clip_key is required",
  error_traceback: '  File "/app/handler.py", line 1, in <module>\n'.repeat(12),
  hostname: "runpod-worker-9zjije5t9aqrhl",
  worker_id: "9zjije5t9aqrhl",
  runpod_version: "1.11.0",
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("parseRunpodErrorType: structured key or nothing", () => {
  it("extracts the class from the measured refusal payload and unwraps python's class repr", () => {
    expect(parseRunpodErrorType(MEASURED_REFUSAL_ERROR)).toBe("HarnessError");
  });

  it("does not depend on error_type being the FIRST key, which is the entire reason for the column", () => {
    const reordered = JSON.stringify({
      hostname: "x".repeat(200),
      error_message: "finish_clip: clip_key is required",
      error_type: "<class 'vivijure_backend.harness.handler.HarnessError'>",
    });
    expect(reordered.length).toBeGreaterThan(DETAIL_MAX);            // CONTROL: detail would lose it
    expect(reordered.indexOf("HarnessError")).toBeGreaterThan(DETAIL_MAX);
    expect(parseRunpodErrorType(reordered)).toBe("HarnessError");
  });

  it("REFUSES to invent a class from a bare error string", () => {
    expect(parseRunpodErrorType("lipsync needs both clip_key and audio_key")).toBeUndefined();
  });

  it("DISCRIMINATES: a structured payload with no error_type key still yields undefined", () => {
    expect(parseRunpodErrorType(JSON.stringify({ error_message: "boom", worker_id: "w" }))).toBeUndefined();
    expect(parseRunpodErrorType({ error_message: "boom" })).toBeUndefined();
    expect(parseRunpodErrorType({ error_type: "   " })).toBeUndefined();
    expect(parseRunpodErrorType(undefined)).toBeUndefined();
    expect(parseRunpodErrorType(42)).toBeUndefined();
  });

  it("bounds the class so a vendor putting a sentence in this key cannot widen the row", () => {
    expect(parseRunpodErrorType({ error_type: "C" + "x".repeat(500) })).toHaveLength(ERROR_TYPE_MAX);
  });
});

describe("the module poll EMITS the markers", () => {
  it("runpodTerminalFailure carries both the status and the class", () => {
    const out = runpodTerminalFailure("own-gpu", { status: "FAILED", error: MEASURED_REFUSAL_ERROR });
    expect(out?.ok).toBe(false);
    expect(out?.runpodStatus).toBe("FAILED");
    expect(out?.errorType).toBe("HarnessError");
  });

  it("distinguishes CANCELLED, which is the status the row could not previously express", () => {
    const out = runpodTerminalFailure("own-gpu", { status: "CANCELLED", error: {} });
    expect(out?.runpodStatus).toBe("CANCELLED");
    expect(out?.errorType).toBeUndefined();
  });

  it("DISCRIMINATES: the RENDER verdict is unchanged, and a running job still returns null", () => {
    // The markers must not have turned a still-running job into a terminal one. Without this, a
    // helper that returned a marker object for every status would pass everything above and fail
    // every render on its first poll tick.
    expect(runpodTerminalFailure("own-gpu", { status: "IN_PROGRESS" })).toBeNull();
    expect(runpodTerminalFailure("own-gpu", { status: "IN_QUEUE" })).toBeNull();
    expect(runpodTerminalFailure("own-gpu", { status: "COMPLETED" })).toBeNull();
    expect(runpodTerminalFailure("own-gpu", {})).toBeNull();
    // ...and the three it always failed still fail, with the same ok:false verdict.
    for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"]) {
      expect(runpodTerminalFailure("own-gpu", { status })?.ok, status).toBe(false);
    }
  });

  it("runpodFaultMarkers reads output as well as error, and omits what it was not told", () => {
    expect(runpodFaultMarkers({ status: "FAILED", output: { error_type: "<class 'builtins.MemoryError'>" } }))
      .toEqual({ runpodStatus: "FAILED", errorType: "MemoryError" });
    // CONTROL: absent stays ABSENT rather than becoming an empty string or a placeholder, so the
    // recorder writes NULL and NULL keeps meaning "not told".
    expect(runpodFaultMarkers({ status: "FAILED", error: "a bare satellite string" }))
      .toEqual({ runpodStatus: "FAILED" });
    expect(runpodFaultMarkers({})).toEqual({});
  });
});

// ------------------------------------------------------------------------------------------------
// THE STUDIO READS THEM. This half is the one that could silently not work: the markers cross an
// HTTP boundary between the module sidecar and the studio, and a field that does not survive that
// hop leaves the column NULL forever while every unit test above still passes.
// ------------------------------------------------------------------------------------------------

/** Drive a real HttpModuleTransport through submit-then-poll with the sidecar stubbed at fetch, and
 *  return every job event the recorder was handed. */
async function recordThrough(pollBody: Record<string, unknown>): Promise<ModuleJobEvent[]> {
  const events: ModuleJobEvent[] = [];
  const transport = new HttpModuleTransport(
    new Map([["MODULE_OWN_GPU", "http://sidecar.invalid"]]),
    (e) => { events.push(e); },
  );
  const fetcher = transport.resolve("MODULE_OWN_GPU");
  if (!fetcher) throw new Error("transport did not resolve the binding");
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.includes("/invoke")
      ? { ok: true, pending: true, jobId: "job-288-abc", poll: "TOKEN-288" }
      : pollBody;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  await fetcher.fetch("http://sidecar.invalid/invoke", { method: "POST", body: "{}" });
  await fetcher.fetch("http://sidecar.invalid/poll", { method: "POST", body: JSON.stringify({ poll: "TOKEN-288" }) });
  // The observation runs on a clone in a detached promise; let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 20));
  return events;
}

describe("the studio READS the markers off the envelope, across the sidecar HTTP hop", () => {
  it("records the class on a refusal that RunPod booked FAILED", async () => {
    const events = await recordThrough({ ok: false, error: "own-gpu job FAILED: ...", errorType: "HarnessError", runpodStatus: "FAILED" });
    // CONTROL: the submit was observed too, so a missing terminal event is a real gap and not a
    // transport that recorded nothing at all.
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
    expect(events[1].errorType).toBe("HarnessError");
    expect(events[1].jobId).toBe("job-288-abc");
  });

  it("records a CANCELLED job as cancelled rather than flattening it into failed", async () => {
    const events = await recordThrough({ ok: false, error: "own-gpu job CANCELLED: {}", runpodStatus: "CANCELLED" });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "cancelled"]);
    expect(events[1].errorType).toBeUndefined();
  });

  it("DISCRIMINATES: an envelope with no markers still records failed, with NO class", async () => {
    // This is every module that has not been taught to emit markers, and the local-GPU door, which
    // is not RunPod at all. It must degrade to exactly the old behaviour, never to a fabricated
    // class and never to `cancelled`.
    const events = await recordThrough({ ok: false, error: "something went wrong" });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
    expect(events[1].errorType).toBeUndefined();
    expect(events[1].detail).toBe("something went wrong");
  });

  it("DISCRIMINATES: a still-pending poll records nothing, so the open row keeps saying open", async () => {
    const events = await recordThrough({ ok: true, pending: true });
    expect(events.map((e) => e.outcome)).toEqual(["submitted"]);
  });
});
