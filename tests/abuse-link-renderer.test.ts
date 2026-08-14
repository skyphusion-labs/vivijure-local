/// <reference types="node" />
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// local#287: the RENDERER half of the abuse-report link (public/abuse-link.js) had no direct
// test anywhere in this repo. tests/abuse-link.test.ts covers the HOST projection
// (host.abuse_report_url) and the parity guard (no hosted address ships in the bundle); the pure
// abuseLink() decision function is exercised only indirectly, through this file, since this repo
// carries no dedicated abuse-link-checks.test.ts (same gap vivijure-cf's own copy of that file
// documents in its header comment and does not close either).
//
// abuse-link.js used to need no second test here because public/ was synced verbatim from
// vivijure-cf and guarded by scripts/upstream-public-parity.sh (byte-identity). That gate was
// retired (local#263 / local#101), so nothing now guarantees this repo's copy of the renderer
// matches the one vivijure-cf exercises through its own eval-based test. This file closes that.
//
// Evals the REAL shipped public/abuse-link-checks.js + public/abuse-link.js, in the same
// <script> order every page loads them in (see public/planner.html), against a minimal stub
// document + fetch -- the repo's established pattern for panel assets with no jsdom and no build
// step (tests/planner-model-picker.test.ts, tests/hook-availability-gate.test.ts). Unlike those
// two files, abuse-link.js exposes no callable function or ready promise: it is a bare IIFE that
// fires its fetch immediately on eval and renders (or does not) with no external hook. So each
// test evals it fresh and flushes a macrotask tick (a microtask-only flush is not safe against a
// promise chain of unknown depth) before asserting on the stub DOM it built.

class El {
  tagName: string;
  className = "";
  textContent = "";
  href = "";
  target = "";
  rel = "";
  children: El[] = [];
  constructor(tag: string) {
    this.tagName = tag;
  }
  appendChild(child: El): El {
    this.children.push(child);
    return child;
  }
}

let body: El;
let g: Record<string, unknown>;

function stubDocument(): void {
  body = new El("body");
  g.document = {
    createElement: (tag: string) => new El(tag),
    // The only selector the renderer ever queries: ".studio-foot", to guard against a double
    // render. Matched against what is actually in body, not hardcoded to always answer null, so
    // the idempotency test below is a real assertion rather than a tautology.
    querySelector: (sel: string) => {
      const cls = sel.replace(/^\./, "");
      return body.children.find((c) => c.className === cls) ?? null;
    },
    body,
  };
  g.window = g; // abuse-link.js reads window.abuseLinkChecks; there is no window in Node.
}

function stubFetch(payload: unknown, ok = true): void {
  g.fetch = async () => ({
    ok,
    json: async () => payload,
  });
}

function evalRenderer(): void {
  (0, eval)(readFileSync("public/abuse-link-checks.js", "utf8"));
  (0, eval)(readFileSync("public/abuse-link.js", "utf8"));
}

// Two .then()s stand between fetch() and render() (or the single .catch() on the failure path).
// A macrotask tick guarantees the whole chain has settled, which a fixed count of microtask
// awaits would not robustly guarantee if that chain ever grows a step.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  g = globalThis as unknown as Record<string, unknown>;
});

describe("public/abuse-link.js (the renderer, local#287)", () => {
  it("renders nothing when the host reports no address, the default self-host install", async () => {
    stubDocument();
    stubFetch({ host: { dispatch: true } });
    evalRenderer();
    await flush();
    expect(body.children).toEqual([]);
  });

  it("renders the link when the host reports an address", async () => {
    stubDocument();
    stubFetch({ host: { abuse_report_url: "https://example.org/report" } });
    evalRenderer();
    await flush();
    expect(body.children.length).toBe(1);
    const foot = body.children[0];
    expect(foot.tagName).toBe("footer");
    expect(foot.className).toBe("studio-foot");
    expect(foot.children.length).toBe(1);
    const link = foot.children[0];
    expect(link.tagName).toBe("a");
    expect(link.href).toBe("https://example.org/report");
    expect(link.textContent).toBe("Report abuse");
    // target=_blank + rel=noopener noreferrer: an operator address is an OFF-SITE link by
    // definition, and the omitted rel is a known reverse-tabnabbing hole.
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("renders nothing when the reported address is refused (unsafe scheme)", async () => {
    stubDocument();
    stubFetch({ host: { abuse_report_url: "javascript:alert(1)" } });
    evalRenderer();
    await flush();
    expect(body.children).toEqual([]);
  });

  it("renders nothing, and does not throw, when the registry fetch fails", async () => {
    stubDocument();
    stubFetch(null, false);
    evalRenderer();
    await flush();
    expect(body.children).toEqual([]);
  });

  it("does not render a second footer on a second pass over the same document", async () => {
    stubDocument();
    stubFetch({ host: { abuse_report_url: "https://example.org/report" } });
    evalRenderer();
    await flush();
    expect(body.children.length).toBe(1);
    // Re-run the whole fetch+render cycle against the SAME stub document/body. The guard in
    // render() ("if (document.querySelector('.' + FOOTER_CLASS)) return;") is what is under
    // test here; without it this would be two footers.
    evalRenderer();
    await flush();
    expect(body.children.length).toBe(1);
  });
});
