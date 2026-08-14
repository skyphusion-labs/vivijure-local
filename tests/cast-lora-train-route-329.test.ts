/// <reference types="node" />
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// local#329 / core#174: the "train Wan LoRA" button used to POST /api/cast/<id>/train-lora with
// body {model_family:"wan"}. /train-lora is the SHARED route, and it resolves an asked-for "wan"
// back to "sdxl" on any host with no Wan training endpoint wired -- so the Wan button trained
// SDXL and said nothing. The explicit /train-wan-lora route hardcodes the family and refuses
// (501) rather than substituting. The button now posts there, and turns that 501 into product
// language instead of the server string, which names an operator env var.
//
// SEAM. This evals the REAL shipped public/cast.js against a minimal stub scope (the repo pattern
// for panel assets: tests/cast-image-picker.test.ts, tests/abuse-link-renderer.test.ts) and calls
// the REAL exported handlers. It deliberately does NOT test an extracted url-builder helper: such
// a test stays green while the shipped handler still posts the old URL inline, which IS the defect
// under repair. Nothing here asserts source text either; every claim is made against what the
// handler actually fetched and what it actually wrote to the status element.

class ElStub {
  textContent = "";
  className = "";
  innerHTML = "";
  href = "";
  src = "";
  alt = "";
  value = "";
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  classList = { add: (): void => {}, remove: (): void => {} };
  children: ElStub[] = [];
  appendChild(c: ElStub): ElStub {
    this.children.push(c);
    return c;
  }
  addEventListener(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}
}

type Call = { url: string; init: Record<string, unknown> | undefined };
type CastRow = Record<string, unknown> & { id: number };
type Helpers = {
  state: { cast: CastRow[]; selectedId: number | null };
  trainLora: () => Promise<void>;
  trainWanLora: () => Promise<void>;
};

const helpers = (): Helpers =>
  (globalThis as unknown as { window: { __castHelpers: Helpers } }).window.__castHelpers;

// The verbatim 501 body published vivijure-core sends when the Wan training endpoint is unwired.
// Kept here as the CONTROL for the redaction assertions below: without it, "the message does not
// name the binding" could pass against a server that never named it in the first place.
const SERVER_501 =
  "Wan cast LoRA training is not configured on this host (wire RUNPOD_WAN_TRAIN_ENDPOINT_ID)";

const WAN_UNAVAILABLE =
  "Wan LoRA training is unavailable here. Ask whoever runs this studio to enable it.";

const CAST: CastRow = {
  id: 7,
  name: "Wren",
  slug: "wren",
  bible: "",
  voice_id: "",
  portrait_key: "cast/7/portrait.png",
  ref_keys: [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }],
  source_keys: [],
  lora_status: "idle",
};

let els: Record<string, ElStub>;
let calls: Call[];
let g: Record<string, unknown>;
let confirmAnswer: boolean;

function el(sel: string): ElStub {
  if (!els[sel]) els[sel] = new ElStub();
  return els[sel];
}

function serve(status: number, payload: Record<string, unknown>): void {
  g.fetch = async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

function initOf(c: Call): Record<string, unknown> {
  return (c.init ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  g = globalThis as unknown as Record<string, unknown>;
  els = {};
  calls = [];
  confirmAnswer = true;
  g.window = {
    addEventListener: (): void => {},
    confirm: (): boolean => confirmAnswer,
    prompt: (): string => "",
  };
  g.document = {
    querySelector: (s: string) => el(s),
    createElement: () => new ElStub(),
    addEventListener: (): void => {},
  };
  g.localStorage = { getItem: () => null, setItem: (): void => {} };
  // Fresh eval per test: cast.js keeps its state in a module-level closure, so reusing one eval
  // would let one test see the cast row another test mutated.
  (0, eval)(readFileSync("public/cast.js", "utf8"));
  helpers().state.cast = [JSON.parse(JSON.stringify(CAST)) as CastRow];
  helpers().state.selectedId = 7;
});

describe("the Wan train button targets the explicit Wan route (local#329)", () => {
  it("CONTROL: a declined confirm records no request at all, so a recorded call means something", async () => {
    serve(501, { error: SERVER_501 });
    confirmAnswer = false;
    await helpers().trainWanLora();
    expect(calls.length).toBe(0);
  });

  it("posts /api/cast/<id>/train-wan-lora, with no family in the body", async () => {
    serve(501, { error: SERVER_501 });
    expect(calls).toEqual([]); // control, before the act, in the same test
    await helpers().trainWanLora();
    expect(calls.length).toBe(1); // the denominator every claim below is one of
    expect(calls[0].url).toBe("/api/cast/7/train-wan-lora");
    expect(initOf(calls[0]).method).toBe("POST");
    // The explicit route hardcodes model_family server-side, so a body would be inert at best
    // and would misrepresent who chooses the family at worst.
    expect(initOf(calls[0]).body).toBeUndefined();
  });

  it("never reaches the shared /train-lora route, which is what silently downgraded to SDXL", async () => {
    serve(501, { error: SERVER_501 });
    await helpers().trainWanLora();
    expect(calls.map((c) => c.url)).toEqual(["/api/cast/7/train-wan-lora"]);
    expect(calls.some((c) => c.url.endsWith("/train-lora"))).toBe(false);
  });

  it("a 501 reads as a host that has not enabled it, and never names the binding", async () => {
    serve(501, { error: SERVER_501 });
    // CONTROL: the server message really does name the env var, so the redaction below is a
    // claim about a real leak and not about a string that was never there.
    expect(SERVER_501).toContain("RUNPOD_WAN_TRAIN_ENDPOINT_ID");
    await helpers().trainWanLora();
    const text = el("#cast-wan-lora-status-text").textContent;
    expect(text).toBe(WAN_UNAVAILABLE);
    expect(text).not.toContain("RUNPOD");
    expect(text).not.toContain("ENDPOINT_ID");
    expect(text).not.toContain("wire ");
    expect(text).not.toContain(SERVER_501);
    // A missing capability is a warn, not a red failure: nothing broke.
    expect(el("#cast-wan-lora-status-text").className).toContain("is-warn");
  });

  it("a non-501 failure keeps the existing message, verbatim", async () => {
    serve(502, { error: "runpod submit failed: no worker" });
    await helpers().trainWanLora();
    expect(el("#cast-wan-lora-status-text").textContent).toBe(
      "submit failed: runpod submit failed: no worker",
    );
    expect(el("#cast-wan-lora-status-text").className).toContain("is-error");
  });

  it("a 409 already-in-flight also keeps the existing message", async () => {
    serve(409, { error: "a LoRA training job is already in flight for this cast member" });
    await helpers().trainWanLora();
    expect(el("#cast-wan-lora-status-text").textContent).toBe(
      "submit failed: a LoRA training job is already in flight for this cast member",
    );
  });
});

describe("the SDXL train button is untouched (local#329 guard)", () => {
  it("still posts /api/cast/<id>/train-lora with an explicit sdxl family", async () => {
    serve(400, { error: "nope" });
    await helpers().trainLora();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/cast/7/train-lora");
    expect(JSON.parse(String(initOf(calls[0]).body))).toEqual({ model_family: "sdxl" });
    expect(el("#cast-lora-status-text").textContent).toBe("submit failed: nope");
  });

  it("NEGATIVE CONTROL: the 501 wording is scoped to Wan, not applied to every handler", async () => {
    serve(501, { error: SERVER_501 });
    await helpers().trainLora();
    expect(el("#cast-lora-status-text").textContent).not.toBe(WAN_UNAVAILABLE);
    expect(el("#cast-lora-status-text").textContent).toContain("submit failed:");
  });
});
