// local#307: an honest soft-degrade must NOT be recorded in runpod_job_log as a completed RunPod job.
//
// THE SHAPE OF THIS TEST, because a suite of stubs proves only the decision path. The envelope under
// test is produced by the SHIPPED handler (pollSpeechUpscale) and read by the SHIPPED transport
// (HttpModuleTransport.observe). The only thing stubbed is the RunPod /status response, which is the
// one seam a unit test cannot own. Nothing here hand-writes a degrade envelope and then asserts the
// transport reads the hand-written shape, because that would test my assumption about the producer.
//
// THE POSITIVE CONTROLS ARE THE POINT. "Degrades are no longer completed" is equally consistent with a
// recorder that stopped recording, so every case asserts the FULL event sequence (the denominator, not
// just the content), a genuine success still records completed, and no-output-key -- which is NOT a
// RunPod fault -- still records completed WHILE PROVING the degrade actually fired.//
// RED-FIRST, AND WHY THIS FILE IMPORTS NOTHING NEW. Every symbol here ships on main before the fix, so
// the file LOADS against unfixed source and fails on the ROW rather than on a missing module. An import
// error would prove nothing about what gets recorded. The unit-level tests for the new reason channel
// live in tests/degrade-reason-307.test.ts, which cannot load pre-fix by construction.
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollSpeechUpscale } from "../src/modules/chain/handlers.js";
import { encodeSpeechPoll } from "../src/modules/chain/speech-upscale-core.js";
import type { ChainModuleEnv } from "../src/modules/chain/chain-env.js";
import { RUNPOD_COLD_GRACE_MS } from "../src/modules/runpod/shared.js";
import { HttpModuleTransport, type ModuleJobEvent } from "../src/platform/modules.js";

const env = {
  RUNPOD_API_KEY: "rp-key-307",
  RUNPOD_ENDPOINT_ID: "ep-307",
} as unknown as ChainModuleEnv;

const AUDIO_KEY = "renders/p/shot-1.wav";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Observed {
  events: ModuleJobEvent[];
  /** The envelope the SHIPPED handler produced, as the transport saw it. */
  envelope: Record<string, unknown>;
}

/**
 * Submit and then poll through the real transport, with the real speech poll handler answering /poll
 * and a stubbed RunPod /status underneath it.
 *
 * `submittedAtAgeMs` ages the poll token: the gone branch only classifies gone-failed past the cold
 * grace window, so a test that forgot to age it would read a healthy cold start as a fault.
 */
async function observePoll(
  statusBody: unknown,
  statusHttp = 200,
  submittedAtAgeMs = 0,
): Promise<Observed> {
  const events: ModuleJobEvent[] = [];
  const transport = new HttpModuleTransport(
    new Map([["MODULE_SPEECH_UPSCALE", "http://sidecar.invalid"]]),
    (e) => {
      events.push(e);
    },
  );
  const fetcher = transport.resolve("MODULE_SPEECH_UPSCALE");
  if (!fetcher) throw new Error("transport did not resolve the speech binding");
  const token = encodeSpeechPoll({
    jobId: "job-307",
    shotId: "shot-1",
    audioKey: AUDIO_KEY,
    submittedAt: Date.now() - submittedAtAgeMs,
  });
  let envelope: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/status/")) return json(statusBody, statusHttp);
      if (url.includes("/cancel")) return json({ ok: true }); // best-effort cancel on the error branch
      if (url.includes("/invoke")) return json({ ok: true, pending: true, jobId: "job-307", poll: token });
      if (url.includes("/poll")) {
        const sent = JSON.parse(String(init?.body ?? "{}")) as { poll: string };
        const r = await pollSpeechUpscale(env, { poll: sent.poll });
        envelope = r as unknown as Record<string, unknown>;
        return json(r);
      }
      throw new Error("unexpected fetch in test: " + url);
    }),
  );
  await fetcher.fetch("http://sidecar.invalid/invoke", { method: "POST", body: "{}" });
  await fetcher.fetch("http://sidecar.invalid/poll", {
    method: "POST",
    body: JSON.stringify({ poll: token }),
  });
  // observe() runs on a cloned body off the response promise chain, by contract, so it lands after the
  // caller already has its answer. Waiting is what that contract COSTS a test, not a race in the code.
  await new Promise((r) => setTimeout(r, 20));
  return { events, envelope };
}

function degradedOf(envelope: Record<string, unknown>): unknown {
  return (envelope.output as Record<string, unknown> | undefined)?.degraded;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a RunPod-fault soft-degrade records the FAULT, not completed (local#307)", () => {
  it("endpoint-gone (404 past the cold grace) => gone", async () => {
    const { events, envelope } = await observePoll(
      { error: "job not found" },
      404,
      RUNPOD_COLD_GRACE_MS + 5_000,
    );
    // The degrade really happened: ok:true, input key passed through, no fake applied tag.
    expect(envelope.ok).toBe(true);
    expect(degradedOf(envelope)).toBe("endpoint-gone");
    expect((envelope.output as { audio_key: string }).audio_key).toBe(AUDIO_KEY);
    expect((envelope.output as { applied: string[] }).applied).toEqual([]);
    // And the row is the RunPod truth, not the chain truth.
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "gone"]);
    expect(events).toHaveLength(2);
    expect(events[1].detail).toBe("endpoint-gone");
  });

  it("endpoint-failed (status FAILED) => failed, detail carries the reason AND the backend text", async () => {
    const { events, envelope } = await observePoll({ status: "FAILED", error: { code: 137 } });
    expect(envelope.ok).toBe(true);
    expect(String(degradedOf(envelope))).toMatch(/^endpoint-failed: /);
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "failed"]);
    expect(events).toHaveLength(2);
    expect(events[1].detail).toContain("endpoint-failed");
    expect(events[1].detail).toContain("137");
    // No structured fault class exists on a degrade envelope; NULL must stay "not told".
    expect(events[1].errorType).toBeUndefined();
  });

  it("endpoint-error (terminal error in output) => backend-error", async () => {
    const { events, envelope } = await observePoll({
      status: "IN_PROGRESS",
      output: { error: "speech_upscale: audio_key is required" },
    });
    expect(envelope.ok).toBe(true);
    expect(String(degradedOf(envelope))).toMatch(/^endpoint-error: /);
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "backend-error"]);
    expect(events).toHaveLength(2);
    expect(events[1].detail).toContain("audio_key is required");
  });
});

describe("POSITIVE CONTROLS: completed still means completed (local#307)", () => {
  it("a genuine success records completed, with no degrade marker at all", async () => {
    const { events, envelope } = await observePoll({
      status: "COMPLETED",
      output: { output_key: "renders/p/shot-1_enh.wav" },
    });
    expect(degradedOf(envelope)).toBeUndefined();
    expect((envelope.output as { applied: string[] }).applied.length).toBeGreaterThan(0);
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "completed"]);
    expect(events).toHaveLength(2);
    expect(events[1].detail).toBeUndefined();
  });

  it("no-output-key STAYS completed -- the job finished, the shortfall is ours", async () => {
    const { events, envelope } = await observePoll({ status: "COMPLETED", output: {} });
    // The degrade DID fire, so completed here is a decision and not a missed branch.
    expect(envelope.ok).toBe(true);
    expect(degradedOf(envelope)).toBe("no-output-key");
    expect(events.map((e) => e.outcome)).toEqual(["submitted", "completed"]);
    expect(events).toHaveLength(2);
  });

  it("still pending records NOTHING terminal (the recorder is not firing on every poll)", async () => {
    const { events, envelope } = await observePoll({ status: "IN_PROGRESS" });
    expect((envelope as { pending?: boolean }).pending).toBe(true);
    expect(events.map((e) => e.outcome)).toEqual(["submitted"]);
    expect(events).toHaveLength(1);
  });
});
