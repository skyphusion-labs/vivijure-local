// local#324 follow-up. Two defects in the degrade signal shipped by PR #353.
//
// (1) THE REASON IS PICKED BY THE BRANCH, NOT BY THE ERROR. `callOllama` throws for four
//     distinguishable conditions and only ONE of them is unreachability:
//       a. fetch rejects (dead process / network)      -> genuinely unreachable
//       b. !resp.ok, e.g. 404 "model not found, pull"  -> THE SERVER ANSWERED
//       c. 200 with empty message content              -> THE SERVER ANSWERED
//       d. OLLAMA_BASE_URL missing                     -> never asked
//     All four land in one `catch` that hardcodes "provider_unreachable", so
//     `ollama_reachable:false` is reported for an Ollama that is UP and merely has no model
//     pulled. An operator paged on that restarts a healthy container. This is the inverse of
//     the 200-{cast:null} defect: that one shows success for work that did not happen, this
//     one shows alarm for work that did.
//
// (2) CHAT MODE DOES NOT FAIL CLOSED ON EVERY PROVIDER, and the untagged case is the one the
//     PR exists to tag. Ollama throws on an empty reply, so chat lands in its catch and
//     returns ok:false. Workers AI `callLocal` RETURNS `data.result?.response`, which may be
//     undefined or "" with no throw, so chat returns
//         { ok:true, notes:["chat skipped: empty reply"] }
//     with no `degraded` and no `degrade_reason`: the exact failure shape this PR adds a
//     signal for, arriving with no signal on it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokePlanEnhance } from "../src/modules/chain/handlers.js";

// Host match by PARSED hostname, never by substring. A substring test is true for a URL that
// merely MENTIONS the provider in a query parameter, and for a lookalike host that has it as a
// prefix of a longer domain -- so it cannot distinguish the real provider from an attacker-chosen
// host. Harmless in a mock router; fixed here because test helpers are the most-copied code in a
// repo and this shape reaches production by imitation.
const isWorkersAI = (u: string | URL): boolean => {
  try {
    return new URL(String(u)).hostname === "api.cloudflare.com";
  } catch {
    return false;
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const storyboard = { scenes: [{ prompt: "wide shot of a dock" }] };
const OLLAMA_ENV = { OLLAMA_BASE_URL: "http://ollama:11434" };
// Workers AI `local` provider: no Ollama, no gateway creds, so pickProvider returns "local".
const LOCAL_ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-fixture", CLOUDFLARE_API_TOKEN: "token-fixture" };

type Degraded = {
  degraded?: unknown;
  degrade_reason?: unknown;
  ollama_reachable?: unknown;
  notes?: string[];
};

async function planWith(env: Record<string, string>, jobId: string): Promise<Degraded> {
  const r = await invokePlanEnhance(env, {
    hook: "plan.enhance",
    input: { storyboard, brief: "harbor" },
    config: { mode: "plan", message: "A quiet harbor at dawn." },
    context: { project: "test", job_id: jobId },
  });
  expect(r.ok, `plan must stay fail-open for render: ${JSON.stringify(r)}`).toBe(true);
  if (!r.ok || !("output" in r) || !r.output) throw new Error("expected ok:true with output");
  return r.output as Degraded;
}

/** Ollama that ANSWERS /api/chat with `reply`, and accepts the unload. */
function ollamaAnswering(reply: () => Response) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/api/chat")) return reply();
    if (url.endsWith("/api/generate")) return new Response("{}", { status: 200 });
    return new Response("nope", { status: 404 });
  });
}

describe("local#324b: the degrade reason comes from the ERROR, not from the branch", () => {
  // CONTROL, RUN FIRST. A genuinely dead Ollama must still report unreachable. Without this
  // the three claims below are equally consistent with "ollama_reachable was hardcoded true".
  it("CONTROL: Ollama STOPPED (fetch rejects) is still provider_unreachable / reachable:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const out = await planWith(OLLAMA_ENV, "j-control-dead");
    const evidence = `reason=${String(out.degrade_reason)} reachable=${String(out.ollama_reachable)}`;
    expect(out.degraded, evidence).toBe(true);
    expect(out.degrade_reason, evidence).toBe("provider_unreachable");
    expect(out.ollama_reachable, evidence).toBe(false);
  });

  it("Ollama UP, model NOT PULLED (404 from /api/chat) is reachable:true, not unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      ollamaAnswering(
        () =>
          new Response(JSON.stringify({ error: 'model "qwen3:14b" not found, try pulling it first' }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const out = await planWith(OLLAMA_ENV, "j-not-pulled");
    const evidence =
      `Ollama answered 404 so it is UP: reason=${String(out.degrade_reason)} ` +
      `reachable=${String(out.ollama_reachable)} note=${String(out.notes?.[0])}`;
    expect(out.degraded, evidence).toBe(true);
    expect(
      out.ollama_reachable,
      "an operator paged on ollama_reachable:false restarts a healthy container. " + evidence,
    ).toBe(true);
    expect(out.degrade_reason, evidence).not.toBe("provider_unreachable");
    expect(out.degrade_reason, evidence).toBe("no_reply");
  });

  it("Ollama UP, 200 with EMPTY content is reachable:true, not unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      ollamaAnswering(
        () =>
          new Response(JSON.stringify({ message: { content: "" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const out = await planWith(OLLAMA_ENV, "j-empty");
    const evidence = `reason=${String(out.degrade_reason)} reachable=${String(out.ollama_reachable)}`;
    expect(out.degraded, evidence).toBe(true);
    expect(out.ollama_reachable, evidence).toBe(true);
    expect(out.degrade_reason, evidence).toBe("no_reply");
  });

  it("DISCRIMINATES: dead and not-pulled no longer share a reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const dead = await planWith(OLLAMA_ENV, "j-d2");
    vi.stubGlobal(
      "fetch",
      ollamaAnswering(() => new Response(JSON.stringify({ error: "not found, pull it" }), { status: 404 })),
    );
    const notPulled = await planWith(OLLAMA_ENV, "j-n2");

    const evidence =
      `dead=(${String(dead.degrade_reason)},${String(dead.ollama_reachable)}) ` +
      `notPulled=(${String(notPulled.degrade_reason)},${String(notPulled.ollama_reachable)})`;
    expect(dead.degraded, evidence).toBe(true);
    expect(notPulled.degraded, evidence).toBe(true);
    expect(
      `${String(dead.ollama_reachable)}/${String(notPulled.ollama_reachable)}`,
      "the whole point of the field is that these two differ. " + evidence,
    ).toBe("false/true");
  });
});

describe("local#324b: chat mode tags its soft-degrade on EVERY provider", () => {
  // CONTROL, RUN FIRST: on a provider that THROWS on an empty reply, chat really does fail
  // closed, so the claim below is about the other provider and not about chat in general.
  it("CONTROL: chat on Ollama with an empty reply fails CLOSED (ok:false)", async () => {
    vi.stubGlobal(
      "fetch",
      ollamaAnswering(() => new Response(JSON.stringify({ message: { content: "" } }), { status: 200 })),
    );
    const r = await invokePlanEnhance(OLLAMA_ENV, {
      hook: "plan.enhance",
      input: { storyboard },
      config: { mode: "chat", message: "pitch me a scene" },
      context: { project: "test", job_id: "j-chat-ollama" },
    });
    expect(r.ok, `control: ${JSON.stringify(r)}`).toBe(false);
  });

  it("chat on Workers AI with an empty reply carries degraded + degrade_reason", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (isWorkersAI(url)) {
        // callLocal RETURNS this. It does not throw. `response` is empty.
        return new Response(JSON.stringify({ result: { response: "" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await invokePlanEnhance(LOCAL_ENV, {
      hook: "plan.enhance",
      input: { storyboard },
      config: { mode: "chat", message: "pitch me a scene" },
      context: { project: "test", job_id: "j-chat-local" },
    });

    // Denominator beside the claim: prove the Workers AI call was actually made, so an
    // untagged result cannot be "the provider was never reached".
    expect(
      fetchMock.mock.calls.filter((c) => isWorkersAI(c[0] as string | URL)).length,
      "control: the Workers AI provider was never called",
    ).toBe(1);

    if (!("output" in r) || !r.output) {
      // Failing closed here would also be a defensible fix; what must not happen is an
      // untagged ok:true. If this branch is ever taken, the claim below is moot by design.
      expect(r.ok, "chat returned no output, so it failed closed").toBe(false);
      return;
    }
    const out = r.output as Degraded;
    const evidence = `ok=${String(r.ok)} out=${JSON.stringify(out)}`;
    expect(out.degraded, "an empty reply is the failure shape this PR exists to tag. " + evidence).toBe(true);
    expect(out.degrade_reason, evidence).toBe("no_reply");
  });

  it("CONTROL: a GOOD Workers AI chat reply carries no degrade fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        isWorkersAI(input)
          ? new Response(JSON.stringify({ result: { response: "a lighthouse at dusk" } }), { status: 200 })
          : new Response("nope", { status: 404 }),
      ),
    );
    const r = await invokePlanEnhance(LOCAL_ENV, {
      hook: "plan.enhance",
      input: { storyboard },
      config: { mode: "chat", message: "pitch me a scene" },
      context: { project: "test", job_id: "j-chat-ok" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("output" in r) || !r.output) throw new Error("expected output");
    const out = r.output as Degraded;
    expect(out.degraded, "no false degrade signal on the success path").toBeUndefined();
    expect(out.degrade_reason).toBeUndefined();
    expect(out.notes?.[0]).toBe("a lighthouse at dusk");
  });
});
