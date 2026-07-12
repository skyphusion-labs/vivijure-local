import { describe, expect, it } from "vitest";
import { planningModelsFromModules, resolvePlanningTarget } from "../src/planning-models.js";
import { MODULE_API, type RegisteredModule } from "@skyphusion-labs/vivijure-core";

const planEnhanceMod: RegisteredModule = {
  name: "plan-enhance",
  version: "0.2.1",
  api: MODULE_API,
  hooks: ["plan.enhance"],
  provides: [{ id: "auto-direction", label: "Test planner" }],
  binding: "MODULE_PLANENHANCE",
  config_schema: {
    model: {
      type: "enum",
      values: ["anthropic/claude-opus-4-8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
      default: "anthropic/claude-opus-4-8",
      label: "model",
    },
  },
};

describe("planning-models", () => {
  it("derives model catalog from plan.enhance module config_schema", () => {
    const models = planningModelsFromModules([planEnhanceMod]);
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-opus-4-8",
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ]);
  });

  it("resolves a model id to the serving module", () => {
    const target = resolvePlanningTarget([planEnhanceMod], "anthropic/claude-opus-4-8");
    expect(target?.moduleName).toBe("plan-enhance");
    expect(target?.configModel).toBe("anthropic/claude-opus-4-8");
  });
});
