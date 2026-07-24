// local#201: the RunPod sidecar advertises a `configured` flag on /module.json, and the panel-facing
// registry drops any module that self-reports configured:false. Together: absent RUNPOD_* creds ->
// the RunPod-backed option is neither visible nor submittable (no "broken button").
import { describe, it, expect } from "vitest";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import { runpodModuleConfigured } from "../src/modules/runpod/handlers.js";
import type { RunpodModuleEnv } from "../src/modules/runpod/env.js";
import { filterConfiguredModules, isModuleConfigured } from "../src/module-registry.js";

async function moduleJson(name: string, env: RunpodModuleEnv): Promise<Record<string, unknown>> {
  const app = createRunpodModuleApp({ name }, name, async () => env);
  const res = await app.fetch(new Request("https://module/module.json"));
  return (await res.json()) as Record<string, unknown>;
}

describe("runpodModuleConfigured (per module kind)", () => {
  it("endpoint-backed modules need API key AND a resolvable endpoint id", () => {
    // NEGATIVE: no creds, key-only, endpoint-only all refuse.
    expect(runpodModuleConfigured({}, "keyframe")).toBe(false);
    expect(runpodModuleConfigured({ RUNPOD_API_KEY: "k" }, "keyframe")).toBe(false);
    expect(runpodModuleConfigured({ KEYFRAME_RUNPOD_ENDPOINT_ID: "ep" }, "keyframe")).toBe(false);
    // POSITIVE control: key + endpoint -> configured.
    expect(runpodModuleConfigured({ RUNPOD_API_KEY: "k", KEYFRAME_RUNPOD_ENDPOINT_ID: "ep" }, "keyframe")).toBe(true);
    expect(runpodModuleConfigured({ RUNPOD_API_KEY: "k", BACKEND_RUNPOD_ENDPOINT_ID: "ep" }, "own-gpu")).toBe(true);
  });

  it("fixed-endpoint cloud i2v modules need ONLY the API key (baked-in endpoint)", () => {
    expect(runpodModuleConfigured({}, "seedance")).toBe(false);
    // An endpoint id without a key is still unconfigured (the key is what is missing).
    expect(runpodModuleConfigured({ RUNPOD_ENDPOINT_ID: "ep" }, "seedance")).toBe(false);
    // POSITIVE control: key alone is enough for a fixed-motion module.
    expect(runpodModuleConfigured({ RUNPOD_API_KEY: "k" }, "seedance")).toBe(true);
  });
});

describe("RunPod sidecar /module.json advertises configured", () => {
  it("reports configured:false with no creds (the refusal the panel hides on)", async () => {
    expect((await moduleJson("keyframe", {})).configured).toBe(false);
    expect((await moduleJson("own-gpu", {})).configured).toBe(false);
    expect((await moduleJson("seedance", {})).configured).toBe(false);
  });

  it("reports configured:true once creds are present (identical-to-today path)", async () => {
    expect((await moduleJson("keyframe", { RUNPOD_API_KEY: "k", KEYFRAME_RUNPOD_ENDPOINT_ID: "ep" })).configured).toBe(true);
    expect((await moduleJson("seedance", { RUNPOD_API_KEY: "k" })).configured).toBe(true);
  });
});

describe("filterConfiguredModules (the clean-hide choke point)", () => {
  const mk = (name: string, configured?: boolean) =>
    ({ name, hooks: ["motion.backend"], ...(configured === undefined ? {} : { configured }) }) as unknown as RegisteredModule;

  it("drops configured:false, keeps configured:true and modules with no flag", () => {
    const mods = [mk("keyframe", false), mk("local-gpu"), mk("own-gpu", true)];
    const kept = filterConfiguredModules(mods).map((m) => m.name);
    expect(kept).toEqual(["local-gpu", "own-gpu"]);
    // CONTROL: an unconfigured module is genuinely ABSENT, not merely last.
    expect(kept).not.toContain("keyframe");
  });

  it("isModuleConfigured: only an EXPLICIT false hides", () => {
    expect(isModuleConfigured(mk("a"))).toBe(true);
    expect(isModuleConfigured(mk("b", true))).toBe(true);
    expect(isModuleConfigured(mk("c", false))).toBe(false);
  });
});
