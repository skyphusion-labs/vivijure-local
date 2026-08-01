// EVERY RunPod SUBMIT RESPONSE CARRIES A TOP-LEVEL jobId (local#294).
//
// WHY THIS EXISTS. vivijure-local writes its runpod_job_log row STUDIO-side, not module-side, because
// the RunPod-submitting sidecars have no database access at all: compose declares 25 module services,
// 9 mount studio-data READ-ONLY, the RunPod submitters mount nothing, and the only read-write mount of
// studio-data belongs to the studio service itself. The studio therefore learns a job id only from what
// the module RETURNS, so a submit response without a top-level jobId is a job the telemetry can never
// record. vivijure-cf does not need this field because its modules hold their own D1 binding and write
// the row themselves: same contract, different writer.
//
// THE CLASS, enumerated rather than diffed against one implementation. Six sites in this repo POST to a
// RunPod /run. Three already returned a top-level jobId (keyframe, own-gpu, fixed-motion); three did
// not (the shared finish submit behind finish-upscale and finish-lipsync, speech-upscale, and
// narration-gen). Scoping this to the finish modules alone would have left two submitters silent.
//
// The field is content-free by construction: a vendor job id, machine generated, never user input.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Hono } from "hono";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { invokeNarrationGen } from "../src/modules/score/handlers.js";
import { invokeSpeechUpscale } from "../src/modules/chain/handlers.js";

const JOB = "job-294-abcdef";

/** Stub every outbound fetch as a RunPod submit accept, and record the URLs so a pass cannot be
    produced by a path that never reached RunPod at all. */
function stubSubmit(): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      seen.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ id: JOB, status: "IN_QUEUE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type Envelope = { ok: boolean; pending?: boolean; jobId?: string; poll?: string; error?: string };

async function invokeApp(app: Hono, body: unknown): Promise<Envelope> {
  const res = await app.fetch(
    new Request("https://module/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as Envelope;
}

describe("the three submitters that were silent now report their job id", () => {
  it("finish submit (finish-upscale, and finish-lipsync behind the same function)", async () => {
    const seen = stubSubmit();
    const app = createRunpodModuleApp({ name: "finish-upscale" }, "finish-upscale", async () => ({
      RUNPOD_API_KEY: "k",
      VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID: "ep",
    }));
    const body = await invokeApp(app, {
      hook: "finish",
      input: { shot_id: "s1", clip_key: "clips/s1.mp4" },
      context: { project: "p1" },
    });
    expect(body.error).toBeUndefined();
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(true);
    expect(body.jobId).toBe(JOB);
    expect(seen.some((u) => u.includes("/run"))).toBe(true);
  });

  it("speech-upscale submit", async () => {
    const seen = stubSubmit();
    const r = (await invokeSpeechUpscale(
      { RUNPOD_API_KEY: "k", AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: "ep" } as never,
      {} as never,
      { hook: "speech.upscale", input: { shot_id: "s1", audio_key: "audio/s1.wav" }, config: { enable: true }, context: { project: "p1" } } as never,
    )) as Envelope;
    expect(r.ok).toBe(true);
    expect(r.jobId).toBe(JOB);
    expect(seen.some((u) => u.includes("/run"))).toBe(true);
  });

  it("narration-gen submit (the RunPod opt-in tier)", async () => {
    const seen = stubSubmit();
    const r = (await invokeNarrationGen({ RUNPOD_API_KEY: "k" } as never, {
      hook: "score",
      input: { film_key: "audio-bed/planner", seconds: 60 },
      config: { text: "Once upon a time in a quiet town." },
      context: { job_id: "job-1", project: "planner" },
    } as never)) as Envelope;
    expect(r.ok).toBe(true);
    expect(r.jobId).toBe(JOB);
    expect(seen.some((u) => u.includes("/run"))).toBe(true);
  });
});

describe("the submitters that already reported it still do (positive control)", () => {
  // Without these, a regression that dropped the field from the ALREADY-correct paths would leave the
  // suite green while making the invariant false, which is the shape this whole lane is about.
  it("keyframe", async () => {
    stubSubmit();
    const app = createRunpodModuleApp({ name: "keyframe" }, "keyframe", async () => ({
      RUNPOD_API_KEY: "k",
      KEYFRAME_RUNPOD_ENDPOINT_ID: "ep",
    }));
    const body = await invokeApp(app, {
      hook: "keyframe",
      input: { project: "p1", bundle_key: "bundles/p1.tar.gz", shot_ids: ["s1"] },
      context: { project: "p1" },
    });
    expect(body.jobId).toBe(JOB);
  });

  it("own-gpu", async () => {
    stubSubmit();
    const app = createRunpodModuleApp({ name: "own-gpu" }, "own-gpu", async () => ({
      RUNPOD_API_KEY: "k",
      BACKEND_RUNPOD_ENDPOINT_ID: "ep",
    }));
    const body = await invokeApp(app, {
      hook: "motion.backend",
      input: { shot_id: "s1", prompt: "a wide shot of the ocean at dusk", seconds: 4 },
      context: { project: "p1" },
    });
    expect(body.jobId).toBe(JOB);
  });
});

describe("fixed-motion submitters (cloud i2v door) report it too", () => {
  it("a fixed-motion module returns the job id", async () => {
    const seen = stubSubmit();
    const app = createRunpodModuleApp({ name: "finish-rife" }, "finish-rife", async () => ({
      RUNPOD_API_KEY: "k",
      BACKEND_RUNPOD_ENDPOINT_ID: "ep",
    }));
    const body = await invokeApp(app, {
      hook: "finish",
      input: { shot_id: "s1", clip_key: "clips/s1.mp4" },
      context: { project: "p1" },
    });
    expect(body.jobId).toBe(JOB);
    expect(seen.some((u) => u.includes("/run"))).toBe(true);
  });
});
