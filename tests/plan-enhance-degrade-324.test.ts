// local#324: plan.enhance fail-open must stay ok:true for render, but monitors must distinguish
// Ollama UP (served, unusable reply) from Ollama STOPPED (fetch failed) without parsing notes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokePlanEnhance } from "../src/modules/chain/handlers.js";
import {
  planFailOpenOutput,
  type PlanEnhanceOutputDegraded,
} from "../src/modules/chain/plan-enhance-degrade.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const storyboard = { scenes: [{ prompt: "wide shot of a dock" }] };

function asDegraded(r: Awaited<ReturnType<typeof invokePlanEnhance>>): PlanEnhanceOutputDegraded {
  expect(r.ok).toBe(true);
  if (!r.ok || !("output" in r) || !r.output) throw new Error("expected ok:true with output");
  return r.output as PlanEnhanceOutputDegraded;
}

describe("planFailOpenOutput helper (local#324)", () => {
  it("marks provider_unreachable with ollama_reachable:false when Ollama was selected", () => {
    const out = planFailOpenOutput(storyboard, "plan skipped: model error (fetch failed)", "provider_unreachable", {
      ollamaSelected: true,
    });
    expect(out.degraded).toBe(true);
    expect(out.degrade_reason).toBe("provider_unreachable");
    expect(out.ollama_reachable).toBe(false);
    expect(out.storyboard).toEqual(storyboard);
  });

  it("marks invalid_reply with ollama_reachable:true (served but unusable)", () => {
    const out = planFailOpenOutput(
      storyboard,
      "plan skipped: ollama/qwen3:14b reply was not valid storyboard JSON",
      "invalid_reply",
      { ollamaSelected: true },
    );
    expect(out.degraded).toBe(true);
    expect(out.degrade_reason).toBe("invalid_reply");
    expect(out.ollama_reachable).toBe(true);
  });

  it("omits ollama_reachable when Ollama was not the selected provider", () => {
    const out = planFailOpenOutput(storyboard, "plan skipped: model error (x)", "provider_unreachable", {
      ollamaSelected: false,
    });
    expect(out.ollama_reachable).toBeUndefined();
  });
});

describe("invokePlanEnhance fail-open is monitorable (local#324)", () => {
  it("Ollama STOPPED (fetch failed) => ok:true + degraded + ollama_reachable:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const r = await invokePlanEnhance(
      { OLLAMA_BASE_URL: "http://ollama:11434" },
      {
        hook: "plan.enhance",
        input: { storyboard, brief: "harbor" },
        config: { mode: "plan", message: "A quiet harbor at dawn." },
        context: { project: "test", job_id: "j-dead" },
      },
    );
    const out = asDegraded(r);
    expect(out.degraded).toBe(true);
    expect(out.degrade_reason).toBe("provider_unreachable");
    expect(out.ollama_reachable).toBe(false);
    // Control: still fail-open for render (unchanged storyboard, not ok:false).
    expect(out.storyboard).toEqual(storyboard);
    expect(out.notes?.[0]).toMatch(/plan skipped: model error/);
  });

  it("Ollama UP but unusable reply => ok:true + degraded + ollama_reachable:true", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/api/chat")) {
        return new Response(JSON.stringify({ message: { content: "not json storyboard at all" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // unload keep_alive:0
      if (url.endsWith("/api/generate")) return new Response("{}", { status: 200 });
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await invokePlanEnhance(
      { OLLAMA_BASE_URL: "http://ollama:11434" },
      {
        hook: "plan.enhance",
        input: { storyboard, brief: "harbor" },
        config: { mode: "plan", message: "A quiet harbor at dawn." },
        context: { project: "test", job_id: "j-up" },
      },
    );
    const out = asDegraded(r);
    expect(out.degraded).toBe(true);
    expect(out.degrade_reason).toBe("invalid_reply");
    expect(out.ollama_reachable).toBe(true);
    expect(out.notes?.[0]).toMatch(/not valid storyboard JSON/);
  });

  it("DISCRIMINATES: the two Ollama states share ok:true but not degrade_reason / ollama_reachable", async () => {
    // STOPPED
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const dead = asDegraded(
      await invokePlanEnhance(
        { OLLAMA_BASE_URL: "http://ollama:11434" },
        {
          hook: "plan.enhance",
          input: { storyboard },
          config: { mode: "enhance", intensity: "medium" },
          context: { project: "test", job_id: "j-d" },
        },
      ),
    );

    // UP, garbage array (wrong length / not array)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/api/chat")) {
          return new Response(JSON.stringify({ message: { content: "prose only" } }), { status: 200 });
        }
        if (url.endsWith("/api/generate")) return new Response("{}", { status: 200 });
        return new Response("nope", { status: 404 });
      }),
    );
    const up = asDegraded(
      await invokePlanEnhance(
        { OLLAMA_BASE_URL: "http://ollama:11434" },
        {
          hook: "plan.enhance",
          input: { storyboard },
          config: { mode: "enhance", intensity: "medium" },
          context: { project: "test", job_id: "j-u" },
        },
      ),
    );

    // Same render-safe envelope shape...
    expect(dead.degraded).toBe(true);
    expect(up.degraded).toBe(true);
    // ...but machine-readable distinction without parsing notes.
    expect(dead.degrade_reason).toBe("provider_unreachable");
    expect(up.degrade_reason).toBe("invalid_reply");
    expect(dead.ollama_reachable).toBe(false);
    expect(up.ollama_reachable).toBe(true);
  });

  it("success path omits degraded fields (no false degrade signal)", async () => {
    const r = await invokePlanEnhance(
      { PLANNER_AI_MOCK: "true" },
      {
        hook: "plan.enhance",
        input: { storyboard },
        config: { mode: "enhance", intensity: "medium" },
        context: { project: "test", job_id: "j-ok" },
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !("output" in r) || !r.output) throw new Error("expected output");
    expect((r.output as { degraded?: unknown }).degraded).toBeUndefined();
    expect((r.output as { degrade_reason?: unknown }).degrade_reason).toBeUndefined();
    expect((r.output as { ollama_reachable?: unknown }).ollama_reachable).toBeUndefined();
  });
});
