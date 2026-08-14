// local#325 follow-up. Two defects in the unload-visibility work shipped by PR #357.
//
// (1) THE HANG PATH HAS NO TIMEOUT. `unloadOllamaModel`'s fetch passes no signal.
//     `AbortSignal.timeout` appears exactly ONCE in all of src/ -- on the local-gpu /health
//     probe at modules/local-gpu/handlers.ts:61 -- and twenty lines below it sits
//     `await ensureOllamaUnloadedForGpu(env)` at :81, OUTSIDE the try that starts at :82.
//     Ten render entry points await that call. A hung Ollama therefore produces neither
//     `unloaded` nor `failed`: it produces an unresolved promise that nothing catches, and
//     the film stops with no status at all. Fail-open only fails open if it RETURNS.
//
// (2) THE LAYER-1 WARN IS UNTESTED, AND IT IS THE ONLY SIGNAL ON THE plan.enhance PATH.
//     The shipped assertion is `parsed.some(p => p.event === "ollama_unload" && ...)` run
//     against `ensureOllamaUnloadedForGpu`, which emits its OWN layer-2 warn -- so `some`
//     is satisfied by either producer and the layer-1 one is never actually asserted.
//     MEASURED by mutation: renaming ONLY the layer-1 event leaves all 14 shipped tests
//     GREEN. `plan-enhance-provider.ts` calls `unloadOllamaModelBestEffort` directly in two
//     `finally` blocks and discards the result, so on that path layer 1 is the whole signal
//     and it can be renamed away with a fully green suite.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureOllamaUnloadedForGpu,
  unloadOllamaModelBestEffort,
} from "../src/modules/chain/ollama.js";
import { direct } from "../src/modules/chain/plan-enhance-provider.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OLLAMA = { OLLAMA_BASE_URL: "http://ollama:11434", OLLAMA_PLAN_MODEL: "qwen3:14b" };

type Warn = { event?: string; status?: string; model?: string; note?: string; timed_out?: unknown };

/** Capture console.warn and return ONLY the JSON payloads, so prose lines cannot satisfy a claim. */
function captureWarns(): { parsed: () => Warn[]; raw: () => string[] } {
  const raw: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    raw.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    raw: () => raw,
    parsed: () =>
      raw
        .map((w) => {
          try {
            return JSON.parse(w) as Warn;
          } catch {
            return null;
          }
        })
        .filter((p): p is Warn => p !== null),
  };
}

/**
 * A fetch stub that HONOURS AbortSignal the way the real one does, and records whether it
 * was given a signal at all. Without the honouring half a never-resolving stub would hang
 * whatever the production code does, so the test would be about the stub. Without the
 * recording half a passing test could not tell "the timeout fired" from "the stub gave up".
 */
function hangingFetch(): {
  fn: ReturnType<typeof vi.fn>;
  sawSignal: () => boolean;
} {
  let sawSignal = false;
  const fn = vi.fn(
    (_input: string | URL, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          sawSignal = true;
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        // No signal -> never settles, exactly like the shipped code against a hung Ollama.
      }),
  );
  return { fn, sawSignal: () => sawSignal };
}

describe("local#325b (1): a hung Ollama must RESOLVE as failed, never hang the render", () => {
  // CONTROL, RUN FIRST. A healthy unload still resolves `unloaded` and is not marked as a
  // timeout. Without this the timeout claims below are consistent with "everything is failed".
  it("CONTROL: a healthy unload still resolves unloaded, with no timeout marking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const r = await ensureOllamaUnloadedForGpu(OLLAMA);
    expect(r, JSON.stringify(r)).toMatchObject({ status: "unloaded", model: "qwen3:14b" });
    expect((r as { timed_out?: unknown }).timed_out, JSON.stringify(r)).toBeUndefined();
  });

  it("the unload fetch is given an AbortSignal at all", async () => {
    const { fn, sawSignal } = hangingFetch();
    vi.stubGlobal("fetch", fn);
    captureWarns();
    await ensureOllamaUnloadedForGpu({ ...OLLAMA, OLLAMA_UNLOAD_TIMEOUT_MS: "50" });
    expect(
      sawSignal(),
      "unloadOllamaModel passed no signal, so nothing can ever cancel a hung Ollama",
    ).toBe(true);
  });

  it("a hung Ollama resolves as failed + timed_out instead of never settling", async () => {
    const { fn } = hangingFetch();
    vi.stubGlobal("fetch", fn);
    const warns = captureWarns();

    const started = Date.now();
    const r = (await Promise.race([
      ensureOllamaUnloadedForGpu({ ...OLLAMA, OLLAMA_UNLOAD_TIMEOUT_MS: "50" }),
      new Promise((resolve) => setTimeout(() => resolve("HUNG"), 3000)),
    ])) as { status?: string; timed_out?: unknown } | "HUNG";
    const elapsed = Date.now() - started;

    expect(r, `elapsed=${elapsed}ms`).not.toBe("HUNG");
    expect(r, `elapsed=${elapsed}ms warns=${JSON.stringify(warns.parsed())}`).toMatchObject({
      status: "failed",
      timed_out: true,
    });
    // The whole point is the render does not wait unbounded.
    expect(elapsed, "resolved, but not within the configured bound").toBeLessThan(2000);
  });

  it("PROBE WITH A NON-DEFAULT VALUE: the configured bound is honoured, not substituted", async () => {
    // On the default the honoured and the substituted case are byte-identical, so this uses
    // a value nothing would pick by accident and checks the elapsed time sits against IT.
    const { fn } = hangingFetch();
    vi.stubGlobal("fetch", fn);
    captureWarns();
    const started = Date.now();
    await ensureOllamaUnloadedForGpu({ ...OLLAMA, OLLAMA_UNLOAD_TIMEOUT_MS: "120" });
    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `elapsed=${elapsed}ms should sit near the configured 120ms, well under the 5000ms default`,
    ).toBeLessThan(1500);
    expect(elapsed, `elapsed=${elapsed}ms should not be instant either`).toBeGreaterThanOrEqual(60);
  });
});

describe("local#325b (2): the LAYER 1 warn is asserted on its own producer", () => {
  // CONTROL, RUN FIRST: the spy can see a payload at all.
  it("CONTROL: the warn capture sees layer 2's payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const warns = captureWarns();
    await ensureOllamaUnloadedForGpu(OLLAMA);
    expect(warns.parsed().length, `raw=${JSON.stringify(warns.raw())}`).toBeGreaterThan(0);
  });

  it("unloadOllamaModelBestEffort ALONE emits the ollama_unload/failed warn", async () => {
    // Layer 1 called DIRECTLY. ensureOllamaUnloadedForGpu is not involved, so its layer-2
    // warn cannot satisfy this and a rename of the layer-1 event goes red here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const warns = captureWarns();
    await unloadOllamaModelBestEffort(OLLAMA);

    const payloads = warns.parsed();
    // Denominator beside the claim.
    expect(payloads.length, `raw=${JSON.stringify(warns.raw())}`).toBe(1);
    expect(payloads[0].event, `payload=${JSON.stringify(payloads[0])}`).toBe("ollama_unload");
    expect(payloads[0].status, `payload=${JSON.stringify(payloads[0])}`).toBe("failed");
    expect(payloads[0].model, `payload=${JSON.stringify(payloads[0])}`).toBe("qwen3:14b");
  });

  it("the plan.enhance path emits it: layer 1 is the ONLY signal those callers have", async () => {
    // plan-enhance-provider calls unloadOllamaModelBestEffort in `finally` and discards the
    // result, so a silent layer 1 means a silent plan.enhance unload failure.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/api/chat")) {
          return new Response(JSON.stringify({ message: { content: "a harbor at dawn" } }), {
            status: 200,
          });
        }
        if (url.endsWith("/api/generate")) throw new Error("ECONNREFUSED");
        return new Response("nope", { status: 404 });
      }),
    );
    const warns = captureWarns();

    const { reply } = await direct(OLLAMA, [{ role: "user", content: "pitch me a scene" }]);
    // Control: the CHAT half succeeded, so a warn below is about the unload and not about a
    // provider that never ran.
    expect(reply, "control: the chat call itself must have succeeded").toBe("a harbor at dawn");

    const payloads = warns.parsed();
    expect(
      payloads.some((p) => p.event === "ollama_unload" && p.status === "failed"),
      `plan.enhance unload failure went silent. raw=${JSON.stringify(warns.raw())}`,
    ).toBe(true);
  });
});
