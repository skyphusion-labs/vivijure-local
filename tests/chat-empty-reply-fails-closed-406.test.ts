import { afterEach, describe, expect, it, vi } from "vitest";
import { invokePlanEnhance } from "../src/modules/chain/handlers.js";
import { CHAT_NO_REPLY_ERROR } from "../src/modules/chain/plan-enhance-degrade.js";

// local#406, ruled 2026-09-26: chat mode FAILS CLOSED on an empty provider reply.
//
// THE DEFECT THIS REPLACES, traced end to end rather than described:
//   handlers.ts  -> ok:true, notes:["chat skipped: empty reply"]
//   planner.ts   -> output = notes.join("\n").trim() = "chat skipped: empty reply"
//   planner.ts   -> if (!output) NOT TAKEN, because the note made it non-empty
//   m10-chat.ts  -> HTTP 200 { output: "chat skipped: empty reply" }
// The skip notice was delivered to the user as the assistant's own answer, and the guard at
// planner.ts that existed to catch exactly this was defeated by the diagnostic prose it was
// supposed to report. A fabricated answer presented as real is the worst outcome available.
//
// WHY THE CLAIM IS ASSERTED ON A CONSTANT: the failure arm of InvokeResponse is
// `{ ok: false; error: string }` and cannot carry `degraded` / `degrade_reason`, so the reason
// rides the error string. Asserting on `CHAT_NO_REPLY_ERROR` rather than on a retyped sentence
// is what stops this test passing while the contract silently changes wording.

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

// Workers AI `local` provider: no Ollama, no gateway creds, so pickProvider returns "local".
// This is the provider that RETURNED an empty string instead of throwing, which is why the
// defect was visible on one provider and not the other.
const LOCAL_ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-fixture", CLOUDFLARE_API_TOKEN: "token-fixture" };

/** Workers AI answering 200 with `reply` as the response field. `null` sends no field at all,
 *  which is the `undefined` case `callLocal` also returns without throwing. */
function stubWorkersAI(reply: string | null): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: string | URL) => {
    if (!isWorkersAI(input)) return new Response("nope", { status: 404 });
    const result = reply === null ? {} : { response: reply };
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const EMPTY_CASES: Array<{ name: string; reply: string | null }> = [
  { name: "empty string", reply: "" },
  { name: "whitespace only", reply: "   \n\t  " },
  { name: "no response field at all (undefined)", reply: null },
];

describe("local#406: an empty provider reply fails closed instead of becoming the answer", () => {
  // POSITIVE CONTROL, FIRST. Without it, "every empty reply is ok:false" is equally consistent
  // with a handler that fails on everything, or one that never reached the provider.
  it("CONTROL: a real reply still succeeds and carries the model text", async () => {
    const mock = stubWorkersAI("a lighthouse at dusk");
    const r = await invokePlanEnhance(LOCAL_ENV, {
      hook: "plan.enhance",
      input: { storyboard: { scenes: [] } },
      config: { mode: "chat", message: "pitch me a scene" },
      context: { project: "test", job_id: "j-ok" },
    });
    const evidence = `r=${JSON.stringify(r)}`;
    expect(r.ok, evidence).toBe(true);
    expect(
      mock.mock.calls.filter((c) => isWorkersAI(c[0] as string | URL)).length,
      "control denominator: the provider was actually called",
    ).toBe(1);
    expect("output" in r && (r.output as { notes?: string[] }).notes, evidence).toEqual([
      "a lighthouse at dusk",
    ]);
  });

  for (const c of EMPTY_CASES) {
    it(`handler: ${c.name} => ok:false carrying the stable reason token`, async () => {
      const mock = stubWorkersAI(c.reply);
      const r = await invokePlanEnhance(LOCAL_ENV, {
        hook: "plan.enhance",
        input: { storyboard: { scenes: [] } },
        config: { mode: "chat", message: "pitch me a scene" },
        context: { project: "test", job_id: "j-empty" },
      });
      const evidence = `${c.name} -> ${JSON.stringify(r)}`;

      // Denominator beside the claim: an ok:false is only meaningful if the provider was reached.
      expect(
        mock.mock.calls.filter((x) => isWorkersAI(x[0] as string | URL)).length,
        `${c.name}: the provider was never called, so this proves nothing`,
      ).toBe(1);

      expect(r.ok, evidence).toBe(false);
      expect("error" in r && r.error, evidence).toBe(CHAT_NO_REPLY_ERROR);
      // A failure must not smuggle a result. `scenes: []` as an `output` on a failed chat is
      // how an empty answer gets rendered as an answer.
      expect(
        Object.prototype.hasOwnProperty.call(r, "output"),
        `${c.name}: a failed chat must not carry an output at all. ${evidence}`,
      ).toBe(false);
    });
  }

  // THE USER-VISIBLE CLAIM, asserted WITHOUT a hand-built module registry.
  //
  // `chatComplete` needs the registry `discoverConfiguredModules` produces, and a hand-rolled
  // stand-in for it would encode my own assumption about the very seam under test. So instead of
  // faking the layer, assert the two properties of the handler response that DECIDE what that
  // layer does, read straight off planner.ts:
  //
  //   planner.ts:276   if (!r.ok) return { ok:false, error: r.error }   <- property 1 fires
  //   planner.ts:280   output = (r.output.notes ?? []).join("\n").trim()
  //   planner.ts:281   if (!output) return { ok:false, ... }            <- property 2 fires too
  //
  // Property 1 alone is the fix. Property 2 is the defence in depth that was MISSING before:
  // previously the skip note made the joined string non-empty, so the guard at :281 could never
  // fire. Now there are no notes to join, so BOTH gates refuse, and m10-chat.ts:72 maps either
  // one to HTTP 422 instead of a 200 whose body is the diagnostic.
  for (const c of EMPTY_CASES) {
    it(`chain: ${c.name} => both planner gates refuse, and no skip notice survives anywhere`, async () => {
      stubWorkersAI(c.reply);
      const r = await invokePlanEnhance(LOCAL_ENV, {
        hook: "plan.enhance",
        input: { storyboard: { scenes: [] } },
        config: { mode: "chat", message: "pitch me a scene" },
        context: { project: "test", job_id: "j-chain" },
      });
      const evidence = `${c.name} -> ${JSON.stringify(r)}`;

      // Gate 1, planner.ts:276.
      expect(r.ok, `${c.name}: planner gate 1 would not fire. ${evidence}`).toBe(false);

      // Gate 2, planner.ts:280-281, evaluated exactly as planner.ts evaluates it.
      const notes = ("output" in r ? (r.output as { notes?: string[] } | undefined)?.notes : undefined) ?? [];
      const joined = notes.join("\n").trim();
      expect(
        joined,
        `${c.name}: the joined notes are non-empty, so the guard at planner.ts:281 is defeated ` +
          `by its own diagnostic prose exactly as before. ${evidence}`,
      ).toBe("");

      // The regression in one line: this string must never reach a caller again.
      expect(
        JSON.stringify(r),
        `${c.name}: the skip notice survived into the response. ${evidence}`,
      ).not.toMatch(/chat skipped/);
    });
  }

  it("CONTROL: on a real reply the joined notes ARE the answer, so gate 2 correctly does not fire", async () => {
    stubWorkersAI("a lighthouse at dusk");
    const r = await invokePlanEnhance(LOCAL_ENV, {
      hook: "plan.enhance",
      input: { storyboard: { scenes: [] } },
      config: { mode: "chat", message: "pitch me a scene" },
      context: { project: "test", job_id: "j-ok2" },
    });
    const notes = ("output" in r ? (r.output as { notes?: string[] } | undefined)?.notes : undefined) ?? [];
    expect(notes.join("\n").trim(), JSON.stringify(r)).toBe("a lighthouse at dusk");
  });
});
