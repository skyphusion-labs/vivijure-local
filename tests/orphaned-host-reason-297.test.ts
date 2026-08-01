// A HOST REASON NOBODY RENDERS IS A REASON NOBODY READS (local#297).
//
// `host.hooks_unavailable` reaches the panel through the shared cf#98 gate, which works by finding
// controls that DECLARE the hook (`data-hook`, `data-hook-advisory`, `data-hook-scope="container"`)
// and attaching the reason to them. If nothing declares the hook, the gate is not broken: it has
// nothing to attach to, and the reason is dropped in silence.
//
// That is exactly the state a PICK_ONE hook reaches with zero serving modules. `renderModuleSection`
// carries the container-scope declaration and only runs per installed module, so zero modules means
// zero declarations. On a studio with no GPU door, `src/local-door-availability.ts` correctly reports
// `keyframe` and `motion.backend` with an operator-actionable string written under the local#226
// "name the knob" rule -- and the operator never saw a word of it. Effort spent on a message that
// could not reach anyone, which is the same waste as a guard that cannot fail.
//
// Worse, `renderPanel` reached its keyframe early return first and printed ONE hardcoded sentence,
// so the hardcoded string was not merely blunter than the host's: it was the thing suppressing it.
//
// ------------------------------------------------------------------------------------------------
// WHY THESE TESTS RUN THE REAL renderPanel AGAINST A HAND-ROLLED DOCUMENT
//
// The fail-once for this fix has to be AT THE RENDER. A test asserting only `renderHookGaps.gaps()`
// output would pass while the panel painted nothing -- the decision would be right and the reason
// still invisible, which is the same defect class as the bug and exactly how this fix could ship
// broken and green. So these evaluate the shipped `public/planner-render-config.js` and assert on the
// DOM it actually produces, the repo's established pattern for panel assets
// (tests/hook-availability-gate.test.ts): no jsdom, no build step.
//
// THE LIMIT, stated rather than left implicit: a stub encodes MY assumptions about the DOM, so this
// proves the production render PATH, not the shipped pixels. That is why the browser look is part of
// done, not a nicety, and why the stub below is deliberately dumb -- it stores what it is given and
// hands it back, so it has few opinions to be wrong about.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import checks from "../public/hook-availability-checks.js";
import gapsApi from "../public/render-hook-gaps.js";
import { LOCAL_DOOR_UNAVAILABLE_REASON } from "../src/local-door-availability.js";
import { VIDEO_FINISH_UNAVAILABLE_REASON } from "../src/video-finish-availability.js";

const REPO = join(import.meta.dirname, "..");
const PANEL_SRC = readFileSync(join(REPO, "public/planner-render-config.js"), "utf8");

// --------------------------------------------------------------------------- the document stub

type Attrs = Record<string, string>;

class El {
  tagName: string;
  attrs: Attrs = {};
  dataset: Record<string, string> = {};
  children: El[] = [];
  parentNode: El | null = null;
  className = "";
  id = "";
  own = ""; // text set directly on this node
  hidden = false;
  open = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  name = "";
  step = "";
  min = "";
  max = "";
  placeholder = "";
  tabIndex = 0;
  selectedIndex = 0;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get classList() {
    const toks = () => (this.className ? this.className.split(/\s+/).filter(Boolean) : []);
    return {
      add: (c: string) => {
        const t = toks();
        if (!t.includes(c)) t.push(c);
        this.className = t.join(" ");
      },
      remove: (c: string) => {
        this.className = toks().filter((x) => x !== c).join(" ");
      },
      contains: (c: string) => toks().includes(c),
      toggle: (c: string, on?: boolean) => {
        if (on) this.classList.add(c);
        else this.classList.remove(c);
      },
    };
  }
  get childNodes(): El[] {
    return this.children;
  }
  get options(): El[] {
    return this.children.filter((c) => c.tagName === "OPTION");
  }
  /** Own text plus every descendant's, which is what the assertions below read. */
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.children = [];
    this.own = String(v);
  }
  set innerHTML(v: string) {
    // Only ever used as `= ""` by the panel. Anything else would be a silent lie, so refuse it.
    if (v !== "") throw new Error("stub innerHTML supports clearing only; the panel changed shape");
    this.children = [];
    this.own = "";
  }
  get innerHTML(): string {
    return "";
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs[n] = v;
  }
  removeAttribute(n: string): void {
    delete this.attrs[n];
  }
  addEventListener(): void {}
  appendChild(c: El): El {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  insertBefore(node: El, ref: El | null): El {
    node.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
    return node;
  }
  get parentElement(): El | null {
    return this.parentNode;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  matchesClass(sel: string): boolean {
    return sel.startsWith(".") && this.classList.contains(sel.slice(1));
  }
  querySelector(sel: string): El | null {
    return this.descendants().find((e) => e.matchesClass(sel)) ?? null;
  }
  querySelectorAll(sel: string): El[] {
    return this.descendants().filter((e) => e.matchesClass(sel));
  }
}

/** A body with only the two containers renderPanel looks up. The quality-tier <select> is left out
 *  deliberately: renderTierPicker returns immediately when it is absent, so omitting it keeps the
 *  stub small without skipping any code path this test cares about. */
function makeDocument() {
  const body = new El("body");
  const root = new El("div");
  root.id = "planner-module-config";
  const motionWrap = new El("div");
  motionWrap.id = "planner-motion-backend-wrap";
  body.appendChild(root);
  body.appendChild(motionWrap);
  const document = {
    createElement: (tag: string) => new El(tag),
    // Walks the live tree rather than a registry snapshot, so an element the panel creates and
    // appends is findable afterwards exactly as in a browser.
    getElementById: (id: string) => (body.id === id ? body : body.descendants().find((e) => e.id === id) ?? null),
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
  };
  return { document, body, root, motionWrap };
}

interface ModulesPayload {
  modules: { name: string; hooks: string[]; config_schema?: Record<string, unknown> }[];
  hooks: Record<string, string[]>;
  catalog: { name: string; blurb: string; cardinality: string; order: number }[];
  render?: unknown;
  host?: { hooks_unavailable?: Record<string, string> };
}

/** The static core catalog, trimmed to the panel hooks. Cardinality is what the fix keys on. */
const CATALOG = [
  { name: "keyframe", blurb: "storyboard -> start keyframes (SDXL)", cardinality: "pick_one", order: 40 },
  { name: "motion.backend", blurb: "keyframe -> shot clip (GPU or cloud)", cardinality: "pick_one", order: 50 },
  { name: "speech", blurb: "clean / enhance dialogue audio", cardinality: "chain", order: 70 },
  { name: "finish", blurb: "interpolation / upscale / face restore", cardinality: "chain", order: 80 },
  { name: "master", blurb: "film-level audio mastering", cardinality: "chain", order: 100 },
];

/** Run the SHIPPED panel IIFE against the stub and return what it rendered. */
async function render(payload: ModulesPayload) {
  const { document, root, motionWrap } = makeDocument();
  const window: Record<string, unknown> = {
    hookAvailabilityChecks: checks,
    renderHookGaps: gapsApi,
    plannerRegistry: { load: async () => {} },
    // hookAvailability is deliberately absent: renderPanel calls it only when present, and the gate
    // is not what is under test here. Leaving it out means nothing but this fix can paint a reason.
  };
  const fetchStub = async () => ({ ok: true, json: async () => payload });
  new Function("window", "document", "fetch", PANEL_SRC)(window, document, fetchStub);
  await (window.plannerRenderConfig as { renderPanel: () => Promise<void> }).renderPanel();
  const notes = root.querySelectorAll(".planner-hook-gap");
  return {
    root,
    motionWrap,
    text: root.textContent,
    notes: notes.map((n) => ({ hook: n.dataset.hookGap, source: n.dataset.hookGapSource, text: n.textContent })),
  };
}

/** A studio with no GPU door: nothing serves keyframe or motion.backend, and the host says why. */
function doorlessPayload(hostReasons: Record<string, string> | null): ModulesPayload {
  return {
    modules: [{ name: "audio-master", hooks: ["master"], config_schema: {} }],
    hooks: { master: ["audio-master"] },
    catalog: CATALOG,
    host: hostReasons ? { hooks_unavailable: hostReasons } : {},
  };
}

const DOORLESS_REASONS = {
  keyframe: LOCAL_DOOR_UNAVAILABLE_REASON,
  "motion.backend": LOCAL_DOOR_UNAVAILABLE_REASON,
};

// --------------------------------------------------------------------------- the defect

describe("a doorless studio renders the host's reason, not silence", () => {
  it("paints the host reason for BOTH pick_one hooks it reported", async () => {
    const out = await render(doorlessPayload(DOORLESS_REASONS));
    expect(out.notes.map((n) => n.hook).sort()).toEqual(["keyframe", "motion.backend"]);
    for (const n of out.notes) expect(n.source).toBe("host");
  });

  it("renders that reason VERBATIM, read from the module rather than hand-copied", async () => {
    // Hand-copying the sentence into a fixture is the local#226 defect with a place to hide: the
    // fixture would keep agreeing with itself after someone edited the real string.
    const out = await render(doorlessPayload(DOORLESS_REASONS));
    expect(out.text).toContain(LOCAL_DOOR_UNAVAILABLE_REASON);
    // The knob the operator can actually turn has to survive into the DOM, not just the gist.
    expect(out.text).toContain("LOCAL_BACKEND_URL");
    expect(out.text).toContain("npm run install:studio");
  });

  it("the hardcoded sentence no longer suppresses it", async () => {
    // The old early return printed this INSTEAD of anything the host said. It is now a fallback, so
    // on a studio whose host explained itself it must not appear at all.
    const out = await render(doorlessPayload(DOORLESS_REASONS));
    expect(out.text).not.toContain("no keyframe module installed");
  });

  it("...but survives as the fallback when the host explains nothing (positive control)", async () => {
    // Without this, "the hardcoded sentence is gone" could be satisfied by deleting it outright and
    // leaving a doorless studio with a completely blank panel, which is worse than the blunt string.
    const out = await render(doorlessPayload(null));
    expect(out.text).toContain("no keyframe module installed");
    expect(out.notes).toEqual([]);
  });

  it("does not claim renders are delivered, on a studio that cannot render", async () => {
    // `speech` and `finish` are unserved here too, and their empty-chain note says the render is
    // delivered without them. True when the pipeline runs; false when there is no keyframe engine at
    // all. Host-sourced notes only on this branch.
    const out = await render(doorlessPayload(DOORLESS_REASONS));
    expect(out.text).not.toContain("Renders are delivered without it");
    expect(out.notes.every((n) => n.source === "host")).toBe(true);
  });

  it("still hides the motion selector, so the fix did not change what it replaced", async () => {
    const out = await render(doorlessPayload(DOORLESS_REASONS));
    expect(out.motionWrap.hidden).toBe(true);
  });
});

// --------------------------------------------------------------------------- no regression

describe("the chain half local#291 closed still works", () => {
  const served: ModulesPayload = {
    modules: [
      { name: "keyframe", hooks: ["keyframe"], config_schema: {} },
      { name: "audio-master", hooks: ["master"], config_schema: {} },
    ],
    hooks: { keyframe: ["keyframe"], master: ["audio-master"] },
    catalog: CATALOG,
    host: {},
  };

  it("an empty CHAIN hook still gets its positive note when the pipeline can run", async () => {
    const out = await render(served);
    const hooks = out.notes.map((n) => n.hook).sort();
    expect(hooks).toEqual(["finish", "speech"]);
    expect(out.text).toContain("Renders are delivered without it");
    expect(out.notes.every((n) => n.source === "empty-chain")).toBe(true);
  });

  it("a served hook still gets no note at all (positive control)", async () => {
    const out = await render(served);
    expect(out.notes.map((n) => n.hook)).not.toContain("master");
    expect(out.notes.map((n) => n.hook)).not.toContain("keyframe");
  });

  it("a host reason on an empty CHAIN hook wins over the generic note", async () => {
    const out = await render({
      ...served,
      host: { hooks_unavailable: { finish: VIDEO_FINISH_UNAVAILABLE_REASON } },
    });
    const finish = out.notes.find((n) => n.hook === "finish");
    expect(finish?.source).toBe("host");
    expect(finish?.text).toBe(VIDEO_FINISH_UNAVAILABLE_REASON);
  });
});

// --------------------------------------------------------------------------- the property

describe("the property, rather than the two hooks that happened to break", () => {
  it("every hook the host reports unservable reaches the DOM, whatever its cardinality", async () => {
    // Stated as a property because #297 was not really about motion.backend: it was about a reason
    // with no renderer. A future hook added to hooks_unavailable with no serving module would have
    // been swallowed the same way, and an instance-shaped test would not have noticed.
    const reasons: Record<string, string> = {
      keyframe: LOCAL_DOOR_UNAVAILABLE_REASON,
      "motion.backend": LOCAL_DOOR_UNAVAILABLE_REASON,
      finish: VIDEO_FINISH_UNAVAILABLE_REASON,
      speech: "Speech enhancement is unavailable on this studio because nothing is wired for it.",
    };
    // Served keyframe so the panel takes the full path, where all four hooks are in play.
    const out = await render({
      modules: [{ name: "keyframe", hooks: ["keyframe"], config_schema: {} }],
      hooks: { keyframe: ["keyframe"] },
      catalog: CATALOG,
      host: { hooks_unavailable: reasons },
    });
    // keyframe IS served here, so its section declares the hook and the cf#98 gate owns that reason;
    // the other three have no serving module and would otherwise be orphaned.
    for (const hook of ["motion.backend", "finish", "speech"]) {
      expect(out.notes.map((n) => n.hook), `${hook} reason was orphaned`).toContain(hook);
      expect(out.text).toContain(reasons[hook]);
    }
  });
});
