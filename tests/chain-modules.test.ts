import { describe, expect, it } from "vitest";
import {
  mergeEnhanced,
  mockEnhanced,
  parseEnhanced,
  scenePrompts,
} from "../src/modules/chain/plan-enhance-core.js";
import { opusModel, pickProvider } from "../src/modules/chain/plan-enhance-provider.js";
import { invokePlanEnhance } from "../src/modules/chain/handlers.js";
import { coerceConfig, passthroughOutput } from "../src/modules/chain/speech-upscale-core.js";

describe("plan.enhance core", () => {
  it("parses a JSON array of rewritten prompts", () => {
    const enhanced = parseEnhanced('["shot one directed", "shot two directed"]', 2);
    expect(enhanced).toEqual(["shot one directed", "shot two directed"]);
  });

  it("merges enhanced prompts back into scenes", () => {
    const sb = { scenes: [{ prompt: "a" }, { prompt: "b" }] };
    const out = mergeEnhanced(sb, ["A+", "B+"]);
    expect(out.scenes[0]?.prompt).toBe("A+");
    expect(out.scenes[1]?.prompt).toBe("B+");
  });

  it("mockEnhanced appends direction suffix", () => {
    expect(mockEnhanced(["harbor at dawn"], "medium")[0]).toContain("directed");
  });
});

describe("plan.enhance provider selection", () => {
  it("picks opus when gateway creds are set", () => {
    expect(pickProvider({ GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" })).toBe("opus");
  });

  it("picks local when model id is a Workers AI slug", () => {
    expect(pickProvider({ GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" }, "@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe(
      "local",
    );
  });

  it("uses default opus when override is the module id", () => {
    expect(opusModel({ GATEWAY_ID: "gw", CF_AIG_TOKEN: "tok" }, "plan-enhance")).toBe("claude-opus-4-8");
  });

  it("honors explicit anthropic model override", () => {
    expect(opusModel({}, "anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });
});

describe("plan.enhance invoke (dev mock)", () => {
  it("plans a storyboard from brief when mode is plan", async () => {
    const r = await invokePlanEnhance(
      { PLANNER_AI_MOCK: "true" },
      {
        hook: "plan.enhance",
        input: { storyboard: { scenes: [] }, brief: "harbor at dawn" },
        config: { mode: "plan", message: "A quiet harbor at dawn." },
        context: { project: "test", job_id: "j1" },
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !("output" in r) || !r.output) throw new Error("expected output");
    expect(r.output.storyboard?.scenes?.length).toBeGreaterThan(0);
  });

  it("returns enhanced storyboard without cloud AI when mode is enhance", async () => {
    const storyboard = { scenes: [{ prompt: "wide shot of a dock" }] };
    const r = await invokePlanEnhance(
      { PLANNER_AI_MOCK: "true" },
      {
        hook: "plan.enhance",
        input: { storyboard },
        config: { mode: "enhance", intensity: "medium" },
        context: { project: "test", job_id: "j1" },
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !("output" in r) || !r.output) throw new Error("expected output");
    const prompts = scenePrompts(r.output.storyboard);
    expect(prompts?.[0]).toContain("directed");
    expect(r.output.notes?.[0]).toContain("dev-mock");
  });
});

describe("speech-upscale", () => {
  it("passthrough when enable is false", () => {
    const out = passthroughOutput({ shot_id: "shot_01", audio_key: "a.wav" }, "disabled");
    expect(out.audio_key).toBe("a.wav");
    expect(out.applied).toEqual([]);
    expect(out.degraded).toBe("disabled");
  });

  it("coerces config defaults", () => {
    expect(coerceConfig({})).toEqual({ enable: false, denoise: false });
  });
});
