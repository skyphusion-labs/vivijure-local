/**
 * local#269: `cast.image` generates its training set on an on-box door, so a homelabber can
 * produce cast references without Cloudflare (epic local#200: RunPod and Cloudflare become
 * deliberate opt-ins, never the default a user discovers they are already on).
 *
 * THE LOAD-BEARING CASES ARE THE NEGATIVES, as in tests/local-speech-door-383.test.ts. An
 * implementation that calls the door on the happy path and quietly retries through Workers AI on
 * any failure satisfies every "it worked" assertion while doing exactly the thing this change
 * exists to stop. So the unusable / unreachable / no-GPU / generate-failed / safety-flag cases
 * each assert that NO Cloudflare host was ever fetched.
 *
 * AND THAT ASSERTION IS PROVED CAPABLE OF FAILING: the control at the bottom removes
 * CAST_IMAGE_BACKEND_URL, runs the same request through the cloud path, and watches the same
 * `cloudflareCalls()` helper light up. Without that control, "no Cloudflare call" would be a
 * green that a broken fetch mock produces just as readily as correct code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { invokeCastImage, pollCastImage } from "../src/modules/chain/handlers.js";
import {
  castImageLocalDoorRaw,
  resolveCastImageBackend,
  type ChainModuleEnv,
} from "../src/modules/chain/chain-env.js";
import {
  LOCAL_CAST_MODEL_TAG,
  isLocalCastModel,
} from "../src/modules/chain/cast-image-local.js";
import { stateBackend } from "../src/modules/chain/cast-image-core.js";
import { SELF_HOST_MODEL_REVISIONS } from "../src/modules/chain/cast-image-model-policy.js";
import { resetDoorCursorsForTests } from "../src/modules/door-pool.js";

// RFC 5737 documentation address: the door is fetch-mocked so nothing routable was ever needed,
// and a real internal address in a tracked file in a PUBLIC repo is what the doc-addresses check
// exists to stop.
const DOOR = "http://192.0.2.60:8785";
// A SECOND door, in a different RFC 5737 block, so the pool is visibly heterogeneous. Needed for
// the "0 reachable" case: orderDoors deliberately does NOT health-probe a single door (that is its
// compatibility guarantee for a door whose /health is unimplemented), so unreachability of a lone
// door surfaces at /generate instead. Both shapes are asserted below.
const DOOR_B = "http://198.51.100.61:8785";
const PINNED_REVISION = SELF_HOST_MODEL_REVISIONS["black-forest-labs/FLUX.2-klein-4B"];

// One-pixel PNG, base64. Real enough that a byte-length assertion means something.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function env(over: Partial<ChainModuleEnv> = {}): ChainModuleEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CF_AIG_TOKEN: "tok",
    GATEWAY_ID: "gw",
    OLLAMA_BASE_URL: "http://192.0.2.61:11434",
    OLLAMA_PLAN_MODEL: "qwen3:14b",
    CAST_IMAGE_BACKEND_URL: DOOR,
    ...over,
  } as ChainModuleEnv;
}

const input = {
  cast_id: 11,
  portrait_url: "http://192.0.2.70/portrait.png",
};

let calls: string[] = [];

/** Every URL fetched this test, in order. The single source for all ordering assertions. */
function allCalls(): string[] {
  return calls;
}

/**
 * Hostname match, NOT a substring match. `u.includes("cloudflare.com")` is
 * js/incomplete-url-substring-sanitization: `http://cloudflare.com.evil.test/` and
 * `http://door/path?x=cloudflare.com` both match it. CodeQL flagged it here and it is right
 * for a sharper reason than style -- a door URL with that string anywhere in it would count
 * as a cloud call and the negatives below would pass for the wrong reason.
 */
function isCloudflareHost(u: string): boolean {
  let host: string;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "cloudflare.com" || host.endsWith(".cloudflare.com");
}

function cloudflareCalls(): string[] {
  return calls.filter(isCloudflareHost);
}

interface DoorBehaviour {
  /** /health status; 502 makes the door unreachable to the shared door-pool probe. */
  health?: number;
  /** /generate status. 503 is the door's own no-CUDA state. */
  generate?: number;
  /** Override the revision the door claims to have loaded. */
  revision?: string;
  /** Return 200 with no image field. */
  emptyImage?: boolean;
  /** /generate rejects at the transport layer (connection refused shape). */
  generateThrows?: boolean;
}

function mockFetch(door: DoorBehaviour = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request | string | URL, init?: RequestInit) => {
      const url = String(req instanceof Request ? req.url : req);
      calls.push(url);

      if (url.startsWith(DOOR) || url.startsWith(DOOR_B)) {
        if (url.endsWith("/health")) {
          return new Response("{}", { status: door.health ?? 200 });
        }
        if (url.endsWith("/unload")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/generate")) {
          if (door.generateThrows) throw new TypeError("fetch failed: ECONNREFUSED");
          const status = door.generate ?? 200;
          if (status !== 200) return new Response("door says no", { status });
          if (door.emptyImage) return new Response(JSON.stringify({ mime: "image/png" }), { status: 200 });
          return new Response(
            JSON.stringify({
              image: PNG_B64,
              mime: "image/png",
              model: "black-forest-labs/FLUX.2-klein-4B",
              revision: door.revision ?? PINNED_REVISION,
            }),
            { status: 200 },
          );
        }
      }

      // Ollama unload (keep_alive:0 control call).
      if (url.includes("11434")) return new Response(JSON.stringify({ done: true }), { status: 200 });

      // Reference image fetch.
      if (url.startsWith("http://192.0.2.70/")) {
        return new Response(Buffer.from(PNG_B64, "base64"), { status: 200 });
      }

      // The CLOUD path. Reached only when the implementation fell through, which is the defect
      // every negative below is watching for -- and which the control at the bottom provokes.
      if (isCloudflareHost(url)) {
        void init;
        return new Response(JSON.stringify({ result: { image: PNG_B64 }, success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("unexpected", { status: 418 });
    }),
  );
}

describe("cast.image backend resolver (local#269)", () => {
  it("presence of CAST_IMAGE_BACKEND_URL selects the door", () => {
    expect(resolveCastImageBackend(env())).toBe("local-door");
  });

  it("an empty variable falls through to Workers AI", () => {
    expect(resolveCastImageBackend(env({ CAST_IMAGE_BACKEND_URL: "   " }))).toBe("workers-ai");
    expect(castImageLocalDoorRaw(env({ CAST_IMAGE_BACKEND_URL: "   " }))).toBe("");
  });

  it("SET BUT UNUSABLE is not UNSET: a typo still selects the door, so it can fail loud", () => {
    // The whole point of the asymmetry. If this returned "workers-ai" the next assertion in this
    // file (unusable -> no cloud call) would be unreachable rather than passing.
    expect(resolveCastImageBackend(env({ CAST_IMAGE_BACKEND_URL: "not-a-url" }))).toBe("local-door");
  });

  it("tags a local run so the record cannot read as a cloud model", () => {
    expect(isLocalCastModel(LOCAL_CAST_MODEL_TAG)).toBe(true);
    expect(isLocalCastModel("@cf/black-forest-labs/flux-2-klein-9b")).toBe(false);
  });
});

describe("cast.image on an on-box door (local#269)", () => {
  let dir: string;
  let store: FilesystemObjectStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-cast-door-"));
    store = new FilesystemObjectStore(dir);
    resetDoorCursorsForTests();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generates on the door, stores the key, and never touches Cloudflare", async () => {
    mockFetch();
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { model: "@cf/black-forest-labs/flux-2-klein-9b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    expect(invoke.ok).toBe(true);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll token");

    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(true);

    const stored = await store.getBytes("cast-gen/11/ref_01.png");
    expect(stored?.bytes.length).toBeGreaterThan(0);
    expect(allCalls().some((u) => u === `${DOOR}/generate`)).toBe(true);
    expect(cloudflareCalls()).toEqual([]);
  });

  it("REPLACES the requested cloud model id rather than reporting one the box never called", async () => {
    mockFetch();
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { model: "@cf/black-forest-labs/flux-2-klein-9b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    let poll = await pollCastImage(e, store, { poll: invoke.poll });
    for (let i = 0; i < 6 && poll.ok && "pending" in poll && poll.pending; i += 1) {
      poll = await pollCastImage(e, store, { poll: invoke.poll });
    }
    expect(poll.ok).toBe(true);
    if (!poll.ok || !("output" in poll) || !poll.output) throw new Error("expected output");
    expect(poll.output.applied).toContain(`model:${LOCAL_CAST_MODEL_TAG}`);
    expect(poll.output.applied.join(" ")).not.toContain("@cf/");
    expect(poll.output.images).toHaveLength(4);
  });

  it("unloads Ollama BEFORE the door generates (sequential VRAM, local#265)", async () => {
    mockFetch();
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    await pollCastImage(e, store, { poll: invoke.poll });

    const ollamaAt = allCalls().findIndex((u) => u.includes("11434"));
    const generateAt = allCalls().findIndex((u) => u === `${DOOR}/generate`);
    expect(ollamaAt).toBeGreaterThanOrEqual(0);
    expect(generateAt).toBeGreaterThanOrEqual(0);
    expect(ollamaAt).toBeLessThan(generateAt);
  });

  it("releases the card with /unload after the last image", async () => {
    mockFetch();
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    let poll = await pollCastImage(e, store, { poll: invoke.poll });
    // Not yet: three prompts remain, the card is still wanted.
    expect(allCalls().filter((u) => u === `${DOOR}/unload`)).toHaveLength(0);
    for (let i = 0; i < 6 && poll.ok && "pending" in poll && poll.pending; i += 1) {
      poll = await pollCastImage(e, store, { poll: invoke.poll });
    }
    expect(allCalls().filter((u) => u === `${DOOR}/unload`)).toHaveLength(1);
  });

  it("pins the door and the backend into run state, not re-resolved per poll", async () => {
    mockFetch();
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const token = JSON.parse(Buffer.from(invoke.poll, "base64").toString("utf8")) as {
      cast_id: number;
      job_id: string;
    };
    const raw = await store.getBytes(`cast-gen/11/${token.job_id}.state.json`);
    const state = JSON.parse(Buffer.from(raw!.bytes).toString("utf8"));
    expect(stateBackend(state)).toBe("local-door");
    expect(state.door_url).toBe(DOOR);
    expect(state.model).toBe(LOCAL_CAST_MODEL_TAG);
  });
});

describe("cast.image door failures NEVER reach Cloudflare (local#269)", () => {
  let dir: string;
  let store: FilesystemObjectStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-cast-door-neg-"));
    store = new FilesystemObjectStore(dir);
    resetDoorCursorsForTests();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("set but unusable: refuses at invoke, no cloud call", async () => {
    mockFetch();
    const e = env({ CAST_IMAGE_BACKEND_URL: "not-a-url" });
    const r = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.error).toContain("0 usable doors");
    expect(cloudflareCalls()).toEqual([]);
  });

  it("a pool with nothing reachable: distinguishable message, no cloud call", async () => {
    mockFetch({ health: 502 });
    const e = env({ CAST_IMAGE_BACKEND_URL: `${DOOR},${DOOR_B}` });
    const r = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.error).toContain("0 reachable");
    // The two refusals must not collapse: an operator fixes a typo and a dead container differently.
    expect(r.error).not.toContain("0 usable doors");
    expect(cloudflareCalls()).toEqual([]);
  });

  it("a LONE unreachable door fails at generate, naming the door, with no cloud call", async () => {
    // orderDoors does not probe a single door on purpose, so this failure cannot appear at invoke.
    // Documented as a test rather than left as a surprise: the operator still gets the door in the
    // message, and the run still never falls through to Workers AI.
    mockFetch({ generateThrows: true });
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    expect(invoke.ok).toBe(true);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error("expected failure");
    expect(poll.error).toContain("unreachable");
    expect(poll.error).toContain(DOOR);
    expect(cloudflareCalls()).toEqual([]);
  });

  it("door has no GPU (503): names the GPU, releases the card, no cloud call", async () => {
    mockFetch({ generate: 503 });
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error("expected failure");
    expect(poll.error).toContain("no usable GPU");
    expect(allCalls().filter((u) => u === `${DOOR}/unload`)).toHaveLength(1);
    expect(cloudflareCalls()).toEqual([]);
  });

  it("generate 500: fails loud, no Workers AI retry", async () => {
    mockFetch({ generate: 500 });
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    expect(cloudflareCalls()).toEqual([]);
  });

  it("an empty image body fails loud rather than storing zero bytes", async () => {
    mockFetch({ emptyImage: true });
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error("expected failure");
    expect(poll.error).toContain("no image");
    expect(await store.getBytes("cast-gen/11/ref_01.png")).toBeNull();
    expect(cloudflareCalls()).toEqual([]);
  });

  it("refuses a door serving a revision other than the one whose licence was read", async () => {
    mockFetch({ revision: "0000000000000000000000000000000000000000" });
    const e = env();
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    const poll = await pollCastImage(e, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error("expected failure");
    expect(poll.error).toContain(PINNED_REVISION);
    expect(cloudflareCalls()).toEqual([]);
  });
});

/**
 * THE CONTROL. Everything above asserts `cloudflareCalls()` is empty, and an empty array is what a
 * broken fetch mock returns too. This case keeps the identical harness, removes only
 * CAST_IMAGE_BACKEND_URL, and requires the SAME helper to come back NON-empty. If this ever goes
 * green with an empty array, every negative above is decoration and this file says so first.
 */
describe("control: the cloud path DOES reach Cloudflare (proves the negatives can fail)", () => {
  let dir: string;
  let store: FilesystemObjectStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-cast-ctrl-"));
    store = new FilesystemObjectStore(dir);
    resetDoorCursorsForTests();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("with no door configured, cast.image fetches a Cloudflare host", async () => {
    mockFetch();
    const e = env({ CAST_IMAGE_BACKEND_URL: undefined });
    expect(resolveCastImageBackend(e)).toBe("workers-ai");
    const invoke = await invokeCastImage(e, store, {
      hook: "cast.image",
      input,
      config: { model: "@cf/black-forest-labs/flux-2-klein-9b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");
    await pollCastImage(e, store, { poll: invoke.poll });
    expect(cloudflareCalls().length).toBeGreaterThan(0);
    expect(allCalls().some((u) => u === `${DOOR}/generate`)).toBe(false);
  });
});
