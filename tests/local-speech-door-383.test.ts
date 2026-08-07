/**
 * local#383: `speech-upscale` routes to an on-box door, so no local traffic reaches the RunPod
 * `vivijure-audio-upscale` endpoint (Conrad: "don't want anything going to those endpoints anymore").
 *
 * THE LOAD-BEARING CASES ARE THE NEGATIVES. An implementation that submits to a door on the happy
 * path but falls back to RunPod on any failure satisfies every "it worked" assertion while doing
 * exactly the thing this change exists to stop, so the unusable / unreachable / submit-failed /
 * unset-mid-job cases each assert that NO RunPod URL was ever fetched -- and the control below
 * proves that assertion can fail, by watching the RunPod path light it up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSpeechBackend, type ChainModuleEnv } from "../src/modules/chain/chain-env.js";
import { invokeSpeechUpscale, pollSpeechUpscale } from "../src/modules/chain/handlers.js";
import { decodeSpeechPoll } from "../src/modules/chain/speech-upscale-core.js";
import { resetDoorCursorsForTests } from "../src/modules/door-pool.js";
import type { ArtifactStore } from "../src/platform/create-storage.js";

// RFC 5737 documentation addresses, deliberately: these doors are fetch-mocked so no routable
// address was ever needed, and a real internal address in a tracked file in a public repo is what
// the doc-addresses check exists to stop. Two DIFFERENT reserved blocks so the pair is visibly
// heterogeneous, which is the property the multi-door path has to handle.
const A = "http://192.0.2.30:8013";
const B = "http://198.51.100.40:8013";

const RUNPOD_HOST = "api.runpod.ai";

function env(over: Partial<ChainModuleEnv> = {}): ChainModuleEnv {
  return {
    RUNPOD_API_KEY: "rp-key",
    AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID: "ep-audio",
    LOCAL_FINISH_TOKEN: "tok",
    ...over,
  } as ChainModuleEnv;
}

const req = {
  input: { shot_id: "shot_01", audio_key: "renders/p/audio/shot_01.wav" },
  config: { enable: true, denoise: false },
  context: { project: "p" },
} as never;

/** A store that must never be touched on the door path; getBytes returning null would look like a mock run. */
const store = {
  getBytes: async () => {
    throw new Error("store touched: the local-door path must not run the byte-copy mock");
  },
  put: async () => {
    throw new Error("store touched: the local-door path must not run the byte-copy mock");
  },
} as unknown as ArtifactStore;

/** Mock fetch. `unhealthy` doors 502 on /health; `runFails` doors 500 on /run. */
let jobSeq = 0;

function mockFetch(opts: { unhealthy?: string[]; runFails?: string[]; status?: string } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.endsWith("/health")) {
        const bad = (opts.unhealthy ?? []).some((d) => url.startsWith(d));
        return new Response("{}", { status: bad ? 502 : 200 });
      }
      if (url.endsWith("/run")) {
        if ((opts.runFails ?? []).some((d) => url.startsWith(d))) {
          return new Response("{}", { status: 500 });
        }
        // OPAQUE job id. It must not contain a path: an id ending in "/run" makes the status URL
        // end in "/run" too, and this mock's own submit arm then answers every poll -- which reads
        // as a permanently-pending job rather than as a broken fixture.
        jobSeq += 1;
        return new Response(JSON.stringify({ id: `job-${jobSeq}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/status/")) {
        return new Response(
          JSON.stringify({
            status: opts.status ?? "COMPLETED",
            output: { output_key: "renders/p/audio/shot_01_enh.wav" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

const runsTo = (calls: string[], door: string) => calls.filter((c) => c === `${door}/run`).length;
const runpodCalls = (calls: string[]) => calls.filter((c) => c.includes(RUNPOD_HOST));
const degradedOf = (r: unknown) =>
  (r as { output?: { degraded?: string; applied?: string[] } }).output;

beforeEach(() => {
  resetDoorCursorsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backend resolution", () => {
  it("CONTROL: with no door set and RunPod configured, it still goes to RunPod", () => {
    expect(resolveSpeechBackend(env())).toBe("runpod");
  });

  it("a set door WINS over a configured RunPod endpoint", () => {
    expect(resolveSpeechBackend(env({ LOCAL_FINISH_SPEECH_URL: A }))).toBe("local-door");
  });

  it("presence wins, not usability: a typo'd door does NOT fall through to RunPod", () => {
    // The whole point. If this returned "runpod" the operator's stated intent would be silently
    // inverted into the cloud call the variable exists to prevent.
    expect(resolveSpeechBackend(env({ LOCAL_FINISH_SPEECH_URL: "not-a-url" }))).toBe("local-door");
  });

  it("neither door nor RunPod leaves the pre-existing mock untouched", () => {
    expect(resolveSpeechBackend({} as ChainModuleEnv)).toBe("mock");
  });

  it("whitespace is not a value", () => {
    expect(resolveSpeechBackend(env({ LOCAL_FINISH_SPEECH_URL: "   " }))).toBe("runpod");
  });
});

describe("submit", () => {
  it("CONTROL: without a door, the submit really does hit RunPod (so the negatives below can fail)", async () => {
    const calls = mockFetch();
    const res = await invokeSpeechUpscale(env(), store, req);
    expect(res.ok).toBe(true);
    // If this control ever came back empty, every "reached RunPod: 0" assertion in this file would
    // be vacuous and would pass against a completely broken implementation.
    expect(runpodCalls(calls).length).toBeGreaterThan(0);
  });

  it("a single door takes NO health probe and submits to it", async () => {
    const calls = mockFetch();
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: A }), store, req);
    expect(res.ok).toBe(true);
    expect((res as { pending?: boolean }).pending).toBe(true);
    expect(calls.filter((c) => c.endsWith("/health"))).toEqual([]);
    expect(runsTo(calls, A)).toBe(1);
    expect(runpodCalls(calls)).toEqual([]);
  });

  it("DISTRIBUTION: six jobs across two healthy doors split 3/3, not 6/0", async () => {
    const calls = mockFetch();
    for (let i = 0; i < 6; i += 1) {
      const r = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
      expect(r.ok).toBe(true);
    }
    // An always-index-0 implementation gives 6/0 here and passes every other test in this file.
    expect(runsTo(calls, A)).toBe(3);
    expect(runsTo(calls, B)).toBe(3);
  });

  it("skips an unhealthy door and serves from the healthy one", async () => {
    const calls = mockFetch({ unhealthy: [A] });
    for (let i = 0; i < 4; i += 1) {
      const r = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
      expect(r.ok).toBe(true);
    }
    expect(runsTo(calls, A)).toBe(0);
    expect(runsTo(calls, B)).toBe(4);
    expect(runpodCalls(calls)).toEqual([]);
  });

  it("fails over when a healthy door refuses /run, and names both doors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = mockFetch({ runFails: [A] });
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
    expect(res.ok).toBe(true);
    expect((res as { pending?: boolean }).pending).toBe(true);
    expect(runsTo(calls, A)).toBe(1);
    expect(runsTo(calls, B)).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).toContain("failed over");
  });

  it("UNUSABLE door degrades honestly and reaches NO RunPod endpoint", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = mockFetch();
    const res = await invokeSpeechUpscale(
      env({ LOCAL_FINISH_SPEECH_URL: "not-a-url,ftp://x" }),
      store,
      req,
    );
    expect(res.ok).toBe(true);
    const out = degradedOf(res);
    expect(out?.degraded).toContain("local-door-unusable");
    expect(out?.applied).toEqual([]); // NO fake tag: nothing was applied
    expect(runpodCalls(calls)).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/2 unusable entries dropped/);
  });

  it("ALL doors unreachable degrades with a count, distinguishably, and reaches NO RunPod endpoint", async () => {
    const calls = mockFetch({ unhealthy: [A, B] });
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
    expect(res.ok).toBe(true);
    const out = degradedOf(res);
    expect(out?.degraded).toContain("local-door-unreachable");
    expect(out?.degraded).toContain("2 configured, 0 reachable");
    expect(out?.applied).toEqual([]);
    expect(runpodCalls(calls)).toEqual([]);

    // An operator acts differently on "configured wrong" and "nothing answers", so they must differ.
    const unusable = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: "nope" }), store, req);
    expect(degradedOf(unusable)?.degraded).not.toBe(out?.degraded);
  });

  it("every door refusing /run degrades rather than reaching RunPod", async () => {
    const calls = mockFetch({ runFails: [A, B] });
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
    expect(res.ok).toBe(true);
    expect(degradedOf(res)?.degraded).toContain("local-door-submit-failed");
    expect(degradedOf(res)?.applied).toEqual([]);
    expect(runpodCalls(calls)).toEqual([]);
  });

  it("passthrough carries the INPUT audio key, so a degrade cannot be mistaken for a result", async () => {
    // TWO doors: a single door takes no health probe at all (the compatibility guarantee), so one
    // unhealthy door still submits. Only a pool with no reachable member reaches the passthrough.
    mockFetch({ unhealthy: [A, B] });
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
    const out = (res as { output?: { audio_key?: string } }).output;
    expect(out?.audio_key).toBe("renders/p/audio/shot_01.wav"); // NOT the _enh key
  });
});

describe("poll affinity", () => {
  it("records the serving door and polls THAT one, not the head of the pool", async () => {
    const calls = mockFetch({ unhealthy: [A] }); // A is down, so B must serve
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), store, req);
    const st = decodeSpeechPoll((res as { poll: string }).poll);
    expect(st?.doorUrl).toBe(B);

    calls.length = 0;
    const p = await pollSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: `${A},${B}` }), {
      poll: (res as { poll: string }).poll,
    } as never);
    expect(p.ok).toBe(true);
    // Job ids live in the serving door's in-process registry; polling the head would 404 and read a
    // healthy job as gone.
    expect(calls.some((c) => c.startsWith(`${B}/status/`))).toBe(true);
    expect(calls.some((c) => c.startsWith(`${A}/status/`))).toBe(false);
    expect(runpodCalls(calls)).toEqual([]);
  });

  it("a completed local-door job is tagged as a local door, never as the RunPod model", async () => {
    mockFetch();
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: A }), store, req);
    const p = await pollSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: A }), {
      poll: (res as { poll: string }).poll,
    } as never);
    const out = (p as { output?: { applied?: string[]; audio_key?: string } }).output;
    expect(out?.applied).toEqual(["speech-upscale:local-door"]);
    expect(out?.audio_key).toBe("renders/p/audio/shot_01_enh.wav");
  });

  it("CONTROL: a RunPod-minted token still polls RunPod and keeps the RunPod tag", async () => {
    const calls = mockFetch();
    const res = await invokeSpeechUpscale(env(), store, req);
    calls.length = 0;
    const p = await pollSpeechUpscale(env(), { poll: (res as { poll: string }).poll } as never);
    expect(runpodCalls(calls).length).toBeGreaterThan(0);
    expect((p as { output?: { applied?: string[] } }).output?.applied).toEqual([
      "speech-upscale:resemble-enhance",
    ]);
  });

  it("a door unset mid-job degrades rather than resurrecting the job on RunPod", async () => {
    mockFetch();
    const res = await invokeSpeechUpscale(env({ LOCAL_FINISH_SPEECH_URL: A }), store, req);
    const calls = mockFetch();
    const p = await pollSpeechUpscale(env(), { poll: (res as { poll: string }).poll } as never);
    expect(p.ok).toBe(true);
    expect(degradedOf(p)?.degraded).toContain("local-door-unconfigured-mid-job");
    expect(runpodCalls(calls)).toEqual([]);
  });
});
