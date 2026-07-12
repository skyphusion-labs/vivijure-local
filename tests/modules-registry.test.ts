import { describe, expect, it } from "vitest";
import {
  discoverModules,
  moduleBindingNames,
  modulesResponse,
  readManifest,
  validateConfig,
  validateManifest,
} from "@skyphusion-labs/vivijure-core";
import { MODULE_API, type ConfigSchema, type RegisteredModule } from "@skyphusion-labs/vivijure-core";
import { renderConfigProjection } from "../src/render-module-config.js";

const manifest = (over = {}) => ({
  name: "finish-rife",
  version: "0.1.0",
  api: MODULE_API,
  hooks: ["finish"],
  ...over,
});

function fakeModule(body: unknown, status = 200) {
  return {
    fetch: async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(manifest())).toMatchObject({ name: "finish-rife", hooks: ["finish"] });
  });

  it("rejects a wrong api version", () => {
    expect(validateManifest(manifest({ api: "vivijure-module/99" }))).toContain("unsupported api");
  });
});

describe("validateConfig", () => {
  const SCHEMA: ConfigSchema = {
    interpolation_factor: { type: "int", min: 1, max: 8, default: 2 },
    fidelity: { type: "float", min: 0, max: 1, default: 0.7 },
    face_restore: { type: "enum", values: ["none", "gfpgan"], default: "none" },
    only_faces: { type: "bool", default: true },
    note: { type: "string", default: "" },
  };

  it("returns defaults when nothing is supplied", () => {
    expect(validateConfig(SCHEMA, undefined)).toEqual({
      interpolation_factor: 2,
      fidelity: 0.7,
      face_restore: "none",
      only_faces: true,
      note: "",
    });
  });
});

describe("moduleBindingNames", () => {
  it("picks MODULE_* fetchers and ignores everything else", () => {
    const env = {
      MODULE_FINISH_RIFE: fakeModule(manifest()),
      MODULE_BROKEN: { not: "a fetcher" },
      ASSETS: fakeModule(manifest()),
      GATEWAY_ID: "abc",
    };
    expect(moduleBindingNames(env)).toEqual(["MODULE_FINISH_RIFE"]);
  });
});

describe("modulesResponse", () => {
  const render = renderConfigProjection();

  it("wraps the registry with the api version and hook index", () => {
    const mods = [{ name: "x", hooks: ["finish"] }] as unknown as RegisteredModule[];
    const r = modulesResponse(mods, render);
    expect(r.api).toBe(MODULE_API);
    expect(r.modules).toHaveLength(1);
    expect(r.hooks.finish).toEqual(["x"]);
  });

  it("serves the static hook catalog independent of installs", () => {
    const r = modulesResponse([], render);
    expect(r.catalog.map((h) => h.name)).toContain("finish");
    expect(r.render.quality_tiers.length).toBeGreaterThan(0);
  });

  it("strips binding from the public module view", () => {
    const mods = [
      { name: "finish-rife", version: "0.1.0", api: MODULE_API, hooks: ["finish"], binding: "MODULE_FINISH_RIFE" },
    ] as unknown as RegisteredModule[];
    const r = modulesResponse(mods, render);
    expect(r.modules[0]).not.toHaveProperty("binding");
  });

  it("carries host.dispatch for local (no WfP)", () => {
    expect(modulesResponse([], render, { dispatch: false }).host).toEqual({ dispatch: false });
  });
});

describe("readManifest / discoverModules", () => {
  it("reads a healthy module", async () => {
    const m = await readManifest("MODULE_FINISH_RIFE", fakeModule(manifest()) as never);
    expect(m).toMatchObject({ name: "finish-rife", binding: "MODULE_FINISH_RIFE" });
  });

  it("discovers only healthy modules from a mixed env", async () => {
    const env = {
      MODULE_GOOD: fakeModule(manifest({ name: "good" })),
      MODULE_BAD: fakeModule({ api: "wrong" }),
      MODULE_DOWN: { fetch: async () => { throw new Error("down"); } },
    };
    const found = await discoverModules(env);
    expect(found.map((m) => m.name)).toEqual(["good"]);
  });
});
