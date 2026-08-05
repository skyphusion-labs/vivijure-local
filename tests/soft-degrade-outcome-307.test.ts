// local#307: an honest soft-degrade must NOT be recorded in runpod_job_log as completed.
// speech-upscale keeps ok:true (chain polish, #249/#77) but the RunPod job failed/gone/
// backend-errored; the studio transport must read the additive outcome marker.
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollSpeechUpscale } from "../src/modules/chain/handlers.js";
import { encodeSpeechPoll } from "../src/modules/chain/speech-upscale-core.js";
import { RUNPOD_COLD_GRACE_MS } from "../src/modules/runpod/shared.js";
import {
  declaredPollOutcome,
  HttpModuleTransport,
  type ModuleJobEvent,
} from "../src/platform/modules.js";

const env = {
  RUNPOD_API_KEY: "rp-key",
  AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: "ep-speech",
} as unknown as Parameters<typeof pollSpeechUpscale>[0];

function pollToken(submittedAt: number): { poll: string } {
  return {
    poll: encodeSpeechPoll({
      jobId: "job-307",
      shotId: "shot_01",
      audioKey: "audio/shot_01.wav",
      submittedAt,
    }),
  };
}

function stubStatus(body: unknown, httpStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      // cancel best-effort on endpoint-error must not break the poll.
      if (url.includes("/cancel/")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify(body), {
        status: httpStatus,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function outcomeOf(r: Awaited<ReturnType<typeof pollSpeechUpscale>>): string | undefined {
  return (r as { outcome?: string }).outcome;
}

describe("speech-upscale soft-degrade EMITS structured outcome (local#307)", () => {
  it("endpoint-gone => ok:true + outcome:gone (chain degrades; job is not completed)", async () => {
    stubStatus({ error: "job not found" }, 404);
    const r = await pollSpeechUpscale(env, pollToken(Date.now() - RUNPOD_COLD_GRACE_MS - 1_000));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r as { pending?: boolean }).pending).toBeUndefined();
    expect(outcomeOf(r)).toBe("gone");
    if (r.ok && "output" in r) {
      expect(r.output.degraded).toMatch(/endpoint-gone/);
    }
  });

  it("endpoint-failed => ok:true + outcome:failed", async () => {
    stubStatus({ status: "FAILED", error: { error_type: "<class 'vivijure_backend.harness.handler.HarnessError'>" } });
    const r = await pollSpeechUpscale(env, pollToken(Date.now()));
    expect(r.ok).toBe(true);
    expect(outcomeOf(r)).toBe("failed");
    expect((r as { errorType?: string }).errorType).toBe("HarnessError");
    expect((r as { detail?: string }).detail).toBeTruthy();
  });

  it("endpoint-error (terminal error in output) => ok:true + outcome:backend-error", async () => {
    stubStatus({
      status: "IN_PROGRESS",
      output: { error: "resemble: input too short" },
    });
    const r = await pollSpeechUpscale(env, pollToken(Date.now()));
    expect(r.ok).toBe(true);
    expect(outcomeOf(r)).toBe("backend-error");
    expect((r as { detail?: string }).detail).toMatch(/resemble/);
  });

  it("no-output-key stays completed (no outcome marker -- RunPod finished)", async () => {
    stubStatus({ status: "COMPLETED", output: { applied: [] } });
    const r = await pollSpeechUpscale(env, pollToken(Date.now()));
    expect(r.ok).toBe(true);
    expect(outcomeOf(r)).toBeUndefined();
    if (r.ok && "output" in r) {
      expect(r.output.degraded).toMatch(/no-output-key/);
    }
  });

  it("DISCRIMINATES: three RunPod faults share ok:true but not outcome", async () => {
    stubStatus({ error: "not found" }, 404);
    const gone = outcomeOf(
      await pollSpeechUpscale(env, pollToken(Date.now() - RUNPOD_COLD_GRACE_MS - 5_000)),
    );

    stubStatus({ status: "FAILED", error: "OOM" });
    const failed = outcomeOf(await pollSpeechUpscale(env, pollToken(Date.now())));

    stubStatus({ status: "IN_PROGRESS", output: { error: "backend refused" } });
    const backend = outcomeOf(await pollSpeechUpscale(env, pollToken(Date.now())));

    expect(gone).toBe("gone");
    expect(failed).toBe("failed");
    expect(backend).toBe("backend-error");
  });
});

describe("studio READS soft-degrade outcome off the envelope (local#307)", () => {
  async function recordThrough(pollBody: Record<string, unknown>): Promise<ModuleJobEvent[]> {
    const events: ModuleJobEvent[] = [];
    const transport = new HttpModuleTransport(
      new Map([["MODULE_SPEECH_UPSCALE", "http://sidecar.invalid"]]),
      (e) => {
        events.push(e);
      },
    );
    const fetcher = transport.resolve("MODULE_SPEECH_UPSCALE");
    if (!fetcher) throw new Error("transport did not resolve");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = url.includes("/invoke")
          ? { ok: true, pending: true, jobId: "job-307-abc", poll: "TOKEN-307" }
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
      body: JSON.stringify({ poll: "TOKEN-307" }),
    });
    await new Promise((r) => setTimeout(r, 20));
    return events;
  }

  it("BEFORE the fix shape: ok:true with no outcome would record completed (control)", async () => {
    // Documents the pre-#307 bug: a degrade without a marker looks like success.
    const events = await recordThrough({
      ok: true,
      output: { shot_id: "s1", audio_key: "a.wav", applied: [], degraded: "endpoint-failed: OOM" },
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "completed"]);
  });

  it("records gone when soft-degrade declares outcome:gone", async () => {
    const events = await recordThrough({
      ok: true,
      output: { shot_id: "s1", audio_key: "a.wav", applied: [], degraded: "endpoint-gone" },
      outcome: "gone",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "gone"]);
  });

  it("records failed when soft-degrade declares outcome:failed + detail", async () => {
    const events = await recordThrough({
      ok: true,
      output: { shot_id: "s1", audio_key: "a.wav", applied: [], degraded: "endpoint-failed: OOM" },
      outcome: "failed",
      detail: "OOM",
      errorType: "HarnessError",
      runpodStatus: "FAILED",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
    expect(events[1].detail).toBe("OOM");
    expect(events[1].errorType).toBe("HarnessError");
  });

  it("records backend-error when soft-degrade declares it", async () => {
    const events = await recordThrough({
      ok: true,
      output: { shot_id: "s1", audio_key: "a.wav", applied: [], degraded: "endpoint-error: x" },
      outcome: "backend-error",
      detail: "resemble: input too short",
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "backend-error"]);
    expect(events[1].detail).toMatch(/resemble/);
  });

  it("no-output-key (ok:true, no outcome) stays completed", async () => {
    const events = await recordThrough({
      ok: true,
      output: { shot_id: "s1", audio_key: "a.wav", applied: [], degraded: "no-output-key" },
    });
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "completed"]);
  });

  it("declaredPollOutcome never invents from prose or widens the set", () => {
    expect(declaredPollOutcome({ ok: true, outcome: "gone" })).toBe("gone");
    expect(declaredPollOutcome({ ok: true, outcome: "failed" })).toBe("failed");
    expect(declaredPollOutcome({ ok: true, outcome: "backend-error" })).toBe("backend-error");
    expect(declaredPollOutcome({ ok: true, outcome: "completed" })).toBeUndefined();
    expect(declaredPollOutcome({ ok: true, outcome: "exploded" })).toBeUndefined();
    expect(declaredPollOutcome({ ok: true, error: "job not found" })).toBeUndefined();
  });
});
