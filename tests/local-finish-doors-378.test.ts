/**
 * local#378: the finish backend takes a LIST of doors, so two GPU cards are capacity rather than a
 * warm spare.
 *
 * Every case here is written so it CAN fail. The load-bearing one is the distribution test: an
 * implementation that always picks index 0 passes any "it did not crash" check while delivering
 * exactly the warm-spare behaviour this change removes, so that test asserts the SPLIT, not success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  localFinishConfigured,
  localFinishUrlFor,
  localFinishUrlsFor,
  normalizeFinishBaseUrls,
  type FinishBackendEnv,
} from "../src/modules/finish-backend.js";
import { __resetDoorCursorForTests, invokeLocalFinish } from "../src/modules/local-finish/handlers.js";
import { decodeFinishPoll } from "../src/modules/runpod/finish-core.js";

const A = "http://door-a:8012";
const B = "http://10.1.1.11:8012";

function env(url: string | undefined): FinishBackendEnv {
  return {
    FINISH_BACKEND: "local",
    LOCAL_FINISH_TOKEN: "tok",
    ...(url === undefined ? {} : { LOCAL_FINISH_UPSCALE_URL: url }),
  };
}

const req = {
  input: { shot_id: "shot_01", clip_key: "renders/p/clips/shot_01.mp4" },
  config: {},
  context: { project: "p" },
} as never;

/** Mock fetch. `unhealthy` doors 502 on /health; /run always succeeds with a per-door job id. */
function mockFetch(unhealthy: string[] = []) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.endsWith("/health")) {
        const bad = unhealthy.some((d) => url.startsWith(d));
        return new Response("{}", { status: bad ? 502 : 200 });
      }
      if (url.endsWith("/run")) {
        return new Response(JSON.stringify({ id: `job-${url}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return calls;
}

const runsTo = (calls: string[], door: string) =>
  calls.filter((c) => c === `${door}/run`).length;

beforeEach(() => {
  __resetDoorCursorForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parsing (pure)", () => {
  it("CONTROL: a single value is unchanged and costs nothing", () => {
    expect(normalizeFinishBaseUrls(A)).toEqual({ urls: [A], dropped: 0 });
    expect(localFinishUrlFor("finish-upscale", env(A))).toBe(A);
    expect(localFinishConfigured("finish-upscale", env(A))).toBe(true);
  });

  it("drops invalid entries AND counts them, rather than failing the whole list", () => {
    const r = normalizeFinishBaseUrls(`${A},not-a-url,ftp://x,${B}`);
    expect(r.urls).toEqual([A, B]);
    expect(r.dropped).toBe(2); // a silently shortened pool is a capacity halving nobody sees
  });

  it("an all-invalid list configures NOTHING (same state as unset)", () => {
    expect(normalizeFinishBaseUrls("nope,ftp://x")).toEqual({ urls: [], dropped: 2 });
    expect(localFinishConfigured("finish-upscale", env("nope,ftp://x"))).toBe(false);
  });

  it("the same door twice is one door", () => {
    expect(localFinishUrlsFor("finish-upscale", env(`${A},${A}/`)).urls).toEqual([A]);
  });
});

describe("submit", () => {
  it("REGRESSION: a single door takes no health probe and behaves exactly as before", async () => {
    const calls = mockFetch();
    const res = await invokeLocalFinish(env(A), "finish-upscale", "upscale_clip", req);
    expect(res.ok).toBe(true);
    expect((res as { pending?: boolean }).pending).toBe(true);
    // The compatibility guarantee: no new round trip, and a door whose /health is unimplemented
    // cannot be turned into a refusal by this change.
    expect(calls.filter((c) => c.endsWith("/health"))).toEqual([]);
    expect(runsTo(calls, A)).toBe(1);
  });

  it("DISTRIBUTION: six jobs across two healthy doors split 3/3, not 6/0", async () => {
    const calls = mockFetch();
    for (let i = 0; i < 6; i += 1) {
      const r = await invokeLocalFinish(env(`${A},${B}`), "finish-upscale", "upscale_clip", req);
      expect(r.ok).toBe(true);
    }
    // An always-index-0 implementation gives 6 and 0 here and passes every other test in this file.
    expect(runsTo(calls, A)).toBe(3);
    expect(runsTo(calls, B)).toBe(3);
  });

  it("skips an unhealthy door and serves from the healthy one", async () => {
    const calls = mockFetch([A]);
    for (let i = 0; i < 4; i += 1) {
      const r = await invokeLocalFinish(env(`${A},${B}`), "finish-upscale", "upscale_clip", req);
      expect(r.ok).toBe(true);
    }
    expect(runsTo(calls, A)).toBe(0);
    expect(runsTo(calls, B)).toBe(4);
  });

  it("ALL doors unhealthy refuses BY NAME, distinguishably from unset", async () => {
    mockFetch([A, B]);
    const allDown = await invokeLocalFinish(env(`${A},${B}`), "finish-upscale", "upscale_clip", req);
    expect(allDown.ok).toBe(false);
    const downMsg = (allDown as { error: string }).error;
    expect(downMsg).toContain("no healthy local finish door");
    expect(downMsg).toContain("2 configured, 0 reachable");

    const unset = await invokeLocalFinish(env(undefined), "finish-upscale", "upscale_clip", req);
    expect(unset.ok).toBe(false);
    const unsetMsg = (unset as { error: string }).error;
    expect(unsetMsg).toContain("LOCAL_FINISH_UPSCALE_URL is unset");

    // The whole point: an operator acts differently on each, so they must not render the same.
    expect(downMsg).not.toBe(unsetMsg);
  });

  it("warns, with a count, when an entry is dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch();
    await invokeLocalFinish(env(`${A},not-a-url`), "finish-upscale", "upscale_clip", req);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/1 unusable entry dropped/);
  });
});

describe("poll affinity", () => {
  it("records the serving door and polls THAT one, not the head of the pool", async () => {
    const calls = mockFetch([A]); // A is down, so B must serve
    const res = await invokeLocalFinish(env(`${A},${B}`), "finish-upscale", "upscale_clip", req);
    expect(res.ok).toBe(true);
    const st = decodeFinishPoll((res as { poll: string }).poll);
    // Job ids live in the serving door's in-process registry; polling the head would 404 and read
    // a healthy job as gone.
    expect(st?.doorUrl).toBe(B);
    expect(calls.some((c) => c === `${B}/run`)).toBe(true);
  });
});
