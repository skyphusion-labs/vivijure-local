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
      values: [
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-sonnet-4-6",
      ],
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
      "anthropic/claude-opus-4-7",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-sonnet-4-6",
    ]);
  });

  // local#101: every planning row names its owning module, and exactly one carries default:true
  // from config_schema.model.default -- so consumers do not parse `group` and the panel can land
  // on the host's declared preference without a hardcoded id.
  it("stamps module ownership and the declared default on every enum row (local#101)", () => {
    const models = planningModelsFromModules([planEnhanceMod]);
    expect(models.every((m) => m.module === "plan-enhance")).toBe(true);
    const defaults = models.filter((m) => m.default === true);
    expect(defaults.map((m) => m.id)).toEqual(["anthropic/claude-opus-4-8"]);
    expect(models.filter((m) => m.default).length).toBe(1);
  });

  it("marks the sole no-enum row as default with module ownership (local#101)", () => {
    const bare: RegisteredModule = {
      ...planEnhanceMod,
      name: "third-party-planner",
      config_schema: undefined,
    };
    const models = planningModelsFromModules([bare]);
    expect(models).toEqual([
      expect.objectContaining({
        id: "third-party-planner",
        module: "third-party-planner",
        default: true,
      }),
    ]);
  });

  it("resolves a model id to the serving module", () => {
    const target = resolvePlanningTarget([planEnhanceMod], "anthropic/claude-opus-4-8");
    expect(target?.moduleName).toBe("plan-enhance");
    expect(target?.configModel).toBe("anthropic/claude-opus-4-8");
  });
});
