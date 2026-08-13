// local#304: the module poll must carry gone / backend-error / failed as a structured field so the
// studio can write runpod_job_log.outcome without parsing English error strings. Pre-#304 those two
// values were unreachable on this door (collapsed into {ok:false, error: prose}).
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollKeyframeRunpod } from "../src/modules/runpod/handlers.js";
import {
  RUNPOD_COLD_GRACE_MS,
  runpodTerminalFailure,
  type RunpodPollOutcome,
} from "../src/modules/runpod/shared.js";
import { encodeKeyframePoll } from "../src/modules/runpod/keyframe-core.js";
import { HttpModuleTransport, pollOutcomeFromEnvelope, type ModuleJobEvent } from "../src/platform/modules.js";

const env = {
  RUNPOD_API_KEY: "rp-key",
  RUNPOD_ENDPOINT_ID: "ep-123",
} as unknown as Parameters<typeof pollKeyframeRunpod>[0];

function pollToken(submittedAt: number): { poll: string } {
  return { poll: encodeKeyframePoll({ jobId: "job-304", project: "p", submittedAt }) };
}

function stubStatus(body: unknown, httpStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: httpStatus,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function outcomeOf(r: Awaited<ReturnType<typeof pollKeyframeRunpod>>): RunpodPollOutcome | undefined {
  expect(r.ok).toBe(false);
  return (r as { outcome?: RunpodPollOutcome }).outcome;
}

describe("module poll EMITS structured outcome (local#304)", () => {
  it("gone-failed (404 past grace) => outcome:gone", async () => {
    stubStatus({ error: "job not found" }, 404);
    const r = await pollKeyframeRunpod(env, pollToken(Date.now() - RUNPOD_COLD_GRACE_MS - 1_000));
    expect(outcomeOf(r)).toBe("gone");
    if (!r.ok) expect(r.error).toMatch(/not found/i);
  });

  it("gone inside grace stays pending (no outcome -- still running)", async () => {
    stubStatus({ error: "job not found" }, 404);
    const r = await pollKeyframeRunpod(env, pollToken(Date.now()));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r as { pending?: boolean }).pending).toBe(true);
    expect((r as { outcome?: unknown }).outcome).toBeUndefined();
  });

  it("terminalErrorInOutput => outcome:backend-error", async () => {
    stubStatus({
      status: "IN_PROGRESS",
      output: { error: "finish_clip: clip_key is required" },
    });
    const r = await pollKeyframeRunpod(env, pollToken(Date.now()));
    expect(outcomeOf(r)).toBe("backend-error");
    if (!r.ok) expect(r.error).toContain("clip_key");
  });

  it("runpodTerminalFailure FAILED => outcome:failed", async () => {
    stubStatus({ status: "FAILED", error: { code: 137 } });
    const r = await pollKeyframeRunpod(env, pollToken(Date.now()));
    expect(outcomeOf(r)).toBe("failed");
  });

  it("runpodTerminalFailure CANCELLED => outcome:cancelled", async () => {
    stubStatus({ status: "CANCELLED" });
    const r = await pollKeyframeRunpod(env, pollToken(Date.now()));
    expect(outcomeOf(r)).toBe("cancelled");
  });

  it("DISCRIMINATES: three classifications share ok:false but not outcome", async () => {
    stubStatus({ error: "not found" }, 404);
    const gone = outcomeOf(
      await pollKeyframeRunpod(env, pollToken(Date.now() - RUNPOD_COLD_GRACE_MS - 5_000)),
    );

    stubStatus({ status: "COMPLETED", output: { error: "backend refused" } });
    // COMPLETED with error in output: terminalErrorInOutput still fires before status gate.
    // Actually order is: gone, backendErr, stringErr, terminalFailure, then COMPLETED check.
    // COMPLETED + output.error => backend-error.
    const backend = outcomeOf(await pollKeyframeRunpod(env, pollToken(Date.now())));

    stubStatus({ status: "TIMED_OUT" });
    const failed = outcomeOf(await pollKeyframeRunpod(env, pollToken(Date.now())));

    expect(gone).toBe("gone");
    expect(backend).toBe("backend-error");
    expect(failed).toBe("failed");
    // Control: helper itself tags CANCELLED as cancelled, not failed.
    expect(runpodTerminalFailure("m", { status: "CANCELLED" })?.outcome).toBe("cancelled");
    expect(runpodTerminalFailure("m", { status: "FAILED" })?.outcome).toBe("failed");
  });
});

describe("studio READS outcome off the envelope (local#304)", () => {
  async function recordThrough(pollBody: Record<string, unknown>): Promise<ModuleJobEvent[]> {
    const events: ModuleJobEvent[] = [];
    const transport = new HttpModuleTransport(
      new Map([["MODULE_OWN_GPU", "http://sidecar.invalid"]]),
      (e) => {
        events.push(e);
      },
    );
    const fetcher = transport.resolve("MODULE_OWN_GPU");
    if (!fetcher) throw new Error("transport did not resolve");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = url.includes("/invoke")
          ? { ok: true, pending: true, jobId: "job-304-abc", poll: "TOKEN-304" }
          : pollBody;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await fetcher.fetch("http://sidecar.invalid/invoke", { method: "POST", body: "{}" });
    await fetcher.fetch("http://sidecar.invalid/poll", {
      method: "POST",
      body: JSON.stringify({ poll: "TOKEN-304" }),
    });
    await new Promise((r) => setTimeout(r, 20));
    return events;
  }

  it("records gone when the module declares outcome:gone", async () => {
    const events = await recordThrough({
      ok: false,
      error: "own-gpu job not found (shot s1)",
      outcome: "gone",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "gone"]);
  });

  it("records backend-error when the module declares it", async () => {
    const events = await recordThrough({
      ok: false,
      error: "clip_key is required",
      outcome: "backend-error",
      errorType: "HarnessError",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "backend-error"]);
    expect(events[1].errorType).toBe("HarnessError");
  });

  it("records failed when the module declares failed", async () => {
    const events = await recordThrough({
      ok: false,
      error: "own-gpu job FAILED: {}",
      outcome: "failed",
      runpodStatus: "FAILED",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
  });

  it("DISCRIMINATES: envelope without outcome still records failed (legacy modules)", async () => {
    const events = await recordThrough({ ok: false, error: "something went wrong" });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
  });

  it("pollOutcomeFromEnvelope never invents from prose", () => {
    expect(pollOutcomeFromEnvelope({ ok: false, error: "job not found" })).toBe("failed");
    expect(pollOutcomeFromEnvelope({ ok: false, error: "x", outcome: "gone" })).toBe("gone");
    expect(pollOutcomeFromEnvelope({ ok: false, error: "x", outcome: "backend-error" })).toBe(
      "backend-error",
    );
    expect(pollOutcomeFromEnvelope({ ok: false, error: "x", runpodStatus: "CANCELLED" })).toBe(
      "cancelled",
    );
    // Unknown / hostile values do not widen the closed set.
    expect(pollOutcomeFromEnvelope({ ok: false, error: "x", outcome: "exploded" })).toBe("failed");
    expect(pollOutcomeFromEnvelope({ ok: false, error: "x", outcome: 42 })).toBe("failed");
  });
});
