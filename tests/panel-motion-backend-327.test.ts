/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { defaultGpuDoorModule as coreDefaultGpuDoor } from "@skyphusion-labs/vivijure-core/modules/registry";

// local#327: render-from-keyframes must name the same gpu door the core would have
// defaulted to. A local door earlier in serving order still resolves to the byo door.
// The shipped planner-registry.js is evaluated here; the assertion is agreement with
// core defaultGpuDoorModule, not a reimplementation of the picker.

function motionModule(name: string, locality: string, order: number) {
  return { name, hooks: ["motion.backend"] as string[], ui: { locality, order } };
}

type PanelModule = ReturnType<typeof motionModule>;

type Door = { name: string } | null;

type PanelRegistry = {
  load: () => Promise<unknown>;
  defaultGpuDoorModule: () => Door;
  gpuDoorMotionModules: () => { name: string }[];
};

function registryWith(modules: PanelModule[]): Promise<PanelRegistry> {
  const src = readFileSync(`${process.cwd()}/public/planner-registry.js`, "utf8");
  const payload = {
    modules,
    hooks: { "motion.backend": modules.map((m) => m.name) },
    catalog: [],
  };
  const scope: { plannerRegistry?: PanelRegistry } = {};
  const fetchImpl = async () => ({ ok: true, json: async () => payload });
  new Function("window", "fetch", src)(scope, fetchImpl);
  const reg = scope.plannerRegistry;
  if (!reg) throw new Error("planner-registry.js did not install plannerRegistry");
  return reg.load().then(() => reg);
}

const BYO = motionModule("own-gpu", "byo", 5);
const LOCAL = motionModule("local-gpu", "local", 4);
const CLOUD = motionModule("seedance", "cloud", 10);

describe("local#327 the panel resolves the same gpu door the core defaults to", () => {
  it.each([
    ["local ordered before byo", [LOCAL, BYO, CLOUD], "own-gpu"],
    ["byo only", [BYO, CLOUD], "own-gpu"],
    ["local only, no byo", [LOCAL, CLOUD], "local-gpu"],
    ["byo listed after a cloud door", [CLOUD, BYO], "own-gpu"],
  ])("%s", async (_label, modules, expected) => {
    const reg = await registryWith(modules);
    const panel = reg.defaultGpuDoorModule();
    expect(panel?.name, "panel picked a different door").toBe(expected);
    const core = coreDefaultGpuDoor(modules as never);
    expect(core?.name, "panel and core disagree about the default door").toBe(panel?.name);
  });

  it("no gpu door installed: the panel names nothing", async () => {
    const reg = await registryWith([CLOUD]);
    expect(reg.defaultGpuDoorModule()).toBeNull();
    expect(coreDefaultGpuDoor([CLOUD] as never)).toBeUndefined();
  });

  it("a cloud door is never the gpu default", async () => {
    const reg = await registryWith([CLOUD, LOCAL]);
    expect(reg.defaultGpuDoorModule()?.name).toBe("local-gpu");
    expect(reg.gpuDoorMotionModules().map((m) => m.name)).toEqual(["local-gpu"]);
    expect(coreDefaultGpuDoor([CLOUD, LOCAL] as never)?.name).toBe("local-gpu");
  });
});

type SubmitBody = Record<string, unknown>;

async function submitRenderFromKeyframes(modules: PanelModule[]): Promise<SubmitBody> {
  const reg = await registryWith(modules);
  const src = readFileSync(`${process.cwd()}/public/planner-bundle.js`, "utf8");
  const planState = { storyboard: { projectName: "reel" } };
  const bundleState = { sceneStartImages: { s1: "k" } };
  const browser = {
    confirm: () => true,
    plannerRegistry: reg,
  };
  let captured: string | null = null;
  const fetchImpl = async (_url: string, init?: { body?: string }) => {
    captured = init?.body ?? null;
    return { ok: true, json: async () => ({ ok: true, jobId: "j1" }) };
  };
  type RenderFromKeyframes = (
    bundleKey: string,
    btn: { disabled: boolean },
    status: { textContent: string },
  ) => Promise<void>;
  const factory = new Function(
    "planState",
    "bundleState",
    "window",
    "gpuMotionLabel",
    "keyframeLabel",
    "$",
    "collectRenderOverrides",
    "fetch",
    "loadHistory",
    `${src}\nreturn renderFromKeyframes;\n`,
  ) as (
    planState: { storyboard: { projectName: string } },
    bundleState: { sceneStartImages: Record<string, string> },
    window: { confirm: () => boolean; plannerRegistry: PanelRegistry },
    gpuMotionLabel: () => string,
    keyframeLabel: () => string,
    $: (sel: string) => { value: string } | null,
    collectRenderOverrides: () => undefined,
    fetch: (url: string, init?: { body?: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
    loadHistory: () => void,
  ) => RenderFromKeyframes;
  const renderFromKeyframes = factory(
    planState,
    bundleState,
    browser,
    () => "GPU i2v",
    () => "SDXL",
    () => null,
    () => undefined,
    fetchImpl,
    () => {},
  );
  await renderFromKeyframes("bundle-key", { disabled: false }, { textContent: "" });
  if (captured === null) throw new Error("render-from-keyframes did not submit a body");
  return JSON.parse(captured) as SubmitBody;
}

describe("local#327 render-from-keyframes body", () => {
  it("names motion_backend when a door resolves, including local-before-byo", async () => {
    const modules = [LOCAL, BYO, CLOUD];
    const body = await submitRenderFromKeyframes(modules);
    const coreName = coreDefaultGpuDoor(modules as never)?.name;
    expect(coreName).toBe("own-gpu");
    expect(body.motion_backend).toBe(coreName);
    expect(body).not.toHaveProperty("motionBackend");
    expect(body.project).toBe("reel");
    expect(body.bundleKey).toBe("bundle-key");
  });

  it("omits motion_backend when no gpu door resolves", async () => {
    const body = await submitRenderFromKeyframes([CLOUD]);
    expect(coreDefaultGpuDoor([CLOUD] as never)).toBeUndefined();
    expect(body).not.toHaveProperty("motion_backend");
    expect(body).not.toHaveProperty("motionBackend");
    expect(JSON.stringify(body)).not.toContain("motion_backend");
  });
});
