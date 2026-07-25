// CONTENT-FREE-BY-CONSTRUCTION LOGS (vivijure-cf#223 stage 1, self-host panel).
//
// PARITY with vivijure-cf/tests/log-scrub.test.ts: same discipline, different surfaces (this panel
// is Node, and its biggest leak was a module stub rather than a router line).
//
// WHAT THIS FILE HAS TO AVOID BEING. "Assert the log line does not contain the project name" is
// UNFALSIFIABLE when the fixture is called `test-project`: the string is absent for boring reasons
// and the test passes just as happily against a completely UNSCRUBBED logger.
//
// SO: SENTINELS + A CONTROL. Every piece of user content is a marker that cannot arrive by another
// route; the assertion is that no marker appears on ANY channel; and a CONTROL test logs the markers
// deliberately and asserts the harness SEES them -- without it, "no sentinel captured" and "the
// harness captures nothing" are the same observation.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { keyLabel, shortId, untrustedLabel } from "../src/log-scrub.js";
import { invokeNotifyEmail } from "../src/modules/chain/handlers.js";
import { generateOpenAIImage } from "../src/providers/openai-image.js";

const S = {
  project: "SENTINEL7PROJECT4b1e9a-my-divorce-film",
  email: "SENTINEL7EMAIL4b1e9a@example.com",
  key: "SENTINEL7KEY4b1e9a",
  prompt: "SENTINEL7PROMPT4b1e9a",
} as const;
const ALL_SENTINELS = Object.values(S);

interface Captured { channel: string; text: string }

function captureConsole(): { lines: Captured[]; restore: () => void } {
  const lines: Captured[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (channel: string) => (...args: unknown[]) => {
    lines.push({
      channel,
      text: args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    });
  };
  console.log = grab("log") as typeof console.log;
  console.warn = grab("warn") as typeof console.warn;
  console.error = grab("error") as typeof console.error;
  console.info = grab("info") as typeof console.info;
  return { lines, restore: () => Object.assign(console, original) };
}

let cap: ReturnType<typeof captureConsole>;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); delete process.env.VIVIJURE_LOG_STUB_EMAIL; });

const haystack = (): string => cap.lines.map((l) => `${l.channel}: ${l.text}`).join("\n");

function expectNoSentinels(): void {
  const all = haystack();
  for (const sentinel of ALL_SENTINELS) {
    expect(all, `sentinel ${sentinel} reached a log line:\n${all}`).not.toContain(sentinel);
  }
}

describe("the capture harness itself", () => {
  it("CONTROL: a sentinel logged on purpose IS captured, on every channel", () => {
    console.log(S.project);
    console.warn(S.key);
    console.error(new Error(`boom ${S.prompt}`));
    console.info(JSON.stringify({ to: S.email }));

    const all = haystack();
    for (const sentinel of ALL_SENTINELS) {
      expect(all, `the harness must SEE ${sentinel} when something logs it`).toContain(sentinel);
    }
    expect(cap.lines.map((l) => l.channel).sort()).toEqual(["error", "info", "log", "warn"]);
  });
});

describe("the notify-email stub logs no message content by default (cf#223)", () => {
  const request = {
    hook: "notify" as const,
    input: {
      event: "render.complete" as const,
      film_id: "film-0a1b2c3d",
      project: S.project,
      download_url: `https://example.test/renders/${S.project}/final.mp4`,
      seconds: 10,
    },
    config: { notify_email: S.email },
    context: { project: S.project, job_id: "job-1" },
  };

  it("prints a recipient LABEL and lengths, never the address, subject or body", async () => {
    const r = await invokeNotifyEmail(request);
    expect(r.ok).toBe(true);

    const line = cap.lines.find((l) => l.text.includes("notify-email"));
    expect(line, `no notify-email line captured:\n${haystack()}`).toBeDefined();
    // POSITIVE: still diagnosable -- the operator can see a message was composed and how big it was.
    expect(line!.text).toContain("to_label");
    expect(line!.text).toContain("subject_length");
    expectNoSentinels();
  });

  it("prints the message when the OPERATOR opts in, because the stub has no other delivery", async () => {
    process.env.VIVIJURE_LOG_STUB_EMAIL = "true";
    await invokeNotifyEmail(request);
    // This is the control for the assertion above: the content IS reachable, so "absent by default"
    // is a decision the code makes rather than a message that was never composed.
    expect(haystack()).toContain(S.email);
  });
});

describe("provider errors do not carry provider prose (cf#223)", () => {
  it("a moderation refusal that quotes the prompt back does NOT reach the exception message", async () => {
    const body = {
      error: {
        message: `Your request was rejected as a result of our safety system. Your prompt "${S.prompt}" may contain content that is not allowed.`,
        type: "invalid_request_error",
        code: "moderation_blocked",
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 400 })) as unknown as typeof fetch;
    let message = "";
    try {
      await generateOpenAIImage("sk-test", "openai/gpt-image-1", S.prompt);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(message).toContain("400");
    expect(message).toContain("moderation_blocked");
    expect(message, "the provider prose quotes the user prompt back").not.toContain(S.prompt);
    expectNoSentinels();
  });
});

describe("the labels themselves", () => {
  it("keyLabel keeps the structural prefix and drops everything user-derived", () => {
    const key = `renders/${S.project}/clips/shot-1.mp4`;
    const label = keyLabel(key);
    expect(label.startsWith("renders/#")).toBe(true);
    expect(label).not.toContain(S.project);
    expect(keyLabel(key)).toBe(label);
    expect(keyLabel(`renders/${S.project}/clips/shot-2.mp4`)).not.toBe(label);
  });

  it("keyLabel handles a key with no prefix without leaking it", () => {
    expect(keyLabel(S.key)).toBe(`#${shortId(S.key)}`);
    expect(keyLabel(S.key)).not.toContain(S.key);
  });

  it("untrustedLabel drops the value of a field an uploaded document controls", () => {
    const label = untrustedLabel(S.email);
    expect(label).not.toContain(S.email);
    expect(label).toContain(`${S.email.length} chars`);
  });
});
