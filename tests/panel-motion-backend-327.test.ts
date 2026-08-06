/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { defaultGpuDoorModule as coreDefaultGpuDoor } from "@skyphusion-labs/vivijure-core/modules/registry";

// local#327 / cf#344: panel must name the SAME gpu door the core would default to on RFK.

function motionModule(name: string, locality: string, order: number) {
  return { name, hooks: ["motion.backend"], ui: { locality, order } };
}

function registryWith(modules: { name: string; ui?: { locality?: string } }[]) {
  const src = readFileSync(`${process.cwd()}/public/planner-registry.js`, "utf8");
  const payload = {
    modules,
    hooks: { "motion.backend": modules.map((m) => m.name) },
    catalog: [],
  };
  const scope: { plannerRegistry?: Record<string, (...a: unknown[]) => unknown> } = {};
  new Function("window", "fetch", src)(scope, () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
  );
  const reg = scope.plannerRegistry!;
  const loaded = reg.load() as Promise<unknown>;
  return loaded.then(() => reg);
}

const BYO = motionModule("own-gpu", "byo", 5);
const LOCAL = motionModule("local-gpu", "local", 4);
const CLOUD = motionModule("seedance", "cloud", 10);

describe("local#327 the panel resolves the SAME gpu door the core would default to", () => {
  it.each([
    ["live shape: local ordered before byo", [LOCAL, BYO, CLOUD], "own-gpu"],
    ["byo only", [BYO, CLOUD], "own-gpu"],
    ["local only, no byo", [LOCAL, CLOUD], "local-gpu"],
    ["byo listed after clouds", [CLOUD, BYO], "own-gpu"],
  ])("%s", async (_label, modules, expected) => {
    const reg = await registryWith(modules);
    const panel = reg.defaultGpuDoorModule() as { name: string } | null;
    expect(panel?.name, "panel picked a different door").toBe(expected);
    const core = coreDefaultGpuDoor(modules as never);
    expect(core?.name, "panel and core disagree about the default door").toBe(panel?.name);
  });

  it("no gpu door installed: the panel names NOTHING rather than inventing one", async () => {
    const reg = await registryWith([CLOUD]);
    expect(reg.defaultGpuDoorModule()).toBeNull();
    expect(coreDefaultGpuDoor([CLOUD] as never)).toBeUndefined();
  });
});

describe("local#327 the wire field name on RFK", () => {
  const BUNDLE = readFileSync(`${process.cwd()}/public/planner-bundle.js`, "utf8");
  const M5 = readFileSync(`${process.cwd()}/src/routes/m5.ts`, "utf8");

  it("the panel sets snake_case motion_backend, which is what the route reads", () => {
    expect(BUNDLE).toContain("body.motion_backend = gpuDoor.name");
    expect(M5).toContain("b.motion_backend ??");
  });

  it("NEGATIVE CONTROL: the panel does NOT send camelCase motionBackend on this body", () => {
    expect(BUNDLE).not.toContain("body.motionBackend");
  });
});
