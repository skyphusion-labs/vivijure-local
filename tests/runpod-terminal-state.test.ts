import { describe, it, expect, vi, afterEach } from "vitest";
import { pollKeyframeRunpod } from "../src/modules/runpod/handlers.js";
import { encodeKeyframePoll } from "../src/modules/runpod/keyframe-core.js";

// #47: a RunPod job in a terminal FAILURE state that carries no error string -- TIMED_OUT, CANCELLED,
// or FAILED with a crashed/OOM worker (non-string `error`) -- was read as pending FOREVER: the poll only
// failed on terminalErrorInOutput(output) or a string `error`, so these states fell through to
// { pending: true } and the shot hung, never surfacing the real failure (honest-failure violation). The
// fix mirrors pollLocalGpu's explicit FAILED/CANCELLED/TIMED_OUT branch via runpodTerminalFailure().

const env = {
  RUNPOD_API_KEY: "rp-key",
  RUNPOD_ENDPOINT_ID: "ep-123",
} as unknown as Parameters<typeof pollKeyframeRunpod>[0];

const poll = { poll: encodeKeyframePoll({ jobId: "job-1", project: "p", submittedAt: Date.now() }) };

function stubStatus(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("RunPod poll fails a terminal-state job instead of hanging on pending (#47)", () => {
  it("TIMED_OUT -> ok:false (not pending)", async () => {
    stubStatus({ status: "TIMED_OUT" });
    const r = await pollKeyframeRunpod(env, poll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/TIMED_OUT/);
  });

  it("CANCELLED -> ok:false (not pending)", async () => {
    stubStatus({ status: "CANCELLED" });
    const r = await pollKeyframeRunpod(env, poll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CANCELLED/);
  });

  it("FAILED with a non-string (structured) error -> ok:false, surfaces the failure", async () => {
    stubStatus({ status: "FAILED", error: { code: 137, reason: "OOM" } });
    const r = await pollKeyframeRunpod(env, poll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/FAILED/);
  });

  it("a still-running state (IN_PROGRESS) stays pending -- no false failure", async () => {
    stubStatus({ status: "IN_PROGRESS" });
    const r = await pollKeyframeRunpod(env, poll);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r as { pending?: boolean }).pending).toBe(true);
  });
});
