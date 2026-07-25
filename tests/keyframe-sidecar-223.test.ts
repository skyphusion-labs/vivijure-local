// local#223 (cf#224 gate 3): the keyframe sidecar must HIDE itself when RunPod is unconfigured
// rather than silently serving dev mock output under the label "GPU Keyframe (SDXL on RunPod)".
//
// These tests exercise the REAL composed sidecar (`createKeyframeSidecarApp`, the exact app
// `scripts/runpod-module-server.ts` serves), not a re-implementation of its routing. That is the
// whole point: the pre-fix defect lived in the COMPOSITION, and tests/runpod-configured-gate.test.ts
// could not see it because it only ever drove `createRunpodModuleApp` directly.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createKeyframeSidecarApp } from "../src/modules/runpod/keyframe-sidecar.js";
import type { RunpodModuleEnv } from "../src/modules/runpod/env.js";
import type { ArtifactStore } from "../src/platform/create-storage.js";
import { filterConfiguredModules } from "../src/module-registry.js";

// The SHIPPED manifest, not a stub: the mock served this file verbatim pre-fix, so a hand-written
// fixture could agree with the bug.
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "dev/manifests/keyframe.json"), "utf8"),
) as Record<string, unknown>;

const CONFIGURED: RunpodModuleEnv = { RUNPOD_API_KEY: "k", KEYFRAME_RUNPOD_ENDPOINT_ID: "ep" };

function memStore(): ArtifactStore & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async put(key: string) {
      keys.push(key);
    },
    async get() {
      return null;
    },
    async getBytes() {
      return null;
    },
    async getRange() {
      return null;
    },
    async head() {
      return null;
    },
    async delete() {},
  } as ArtifactStore & { keys: string[] };
}

function sidecar(env: RunpodModuleEnv) {
  const store = memStore();
  return { app: createKeyframeSidecarApp(manifest, async () => env, store), store };
}

async function moduleJson(env: RunpodModuleEnv): Promise<Record<string, unknown>> {
  const { app } = sidecar(env);
  const res = await app.fetch(new Request("https://module/module.json"));
  expect(res.status).toBe(200); // the compose healthcheck curls this path
  return (await res.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keyframe sidecar /module.json is served by the RunPod app in BOTH states (local#223)", () => {
  it("unconfigured: reports configured:false (pre-fix this key was ABSENT, served by the mock)", async () => {
    const body = await moduleJson({});
    // The discriminating assertion. Pre-fix the mock answered here and returned the raw manifest, so
    // `configured` was undefined -- and undefined means "always keep" at the registry choke point.
    expect(Object.keys(body)).toContain("configured");
    expect(body.configured).toBe(false);
    // CONTROL: this is the real manifest, not an empty object that would satisfy the above vacuously.
    expect((body.provides as { label: string }[])[0].label).toBe("GPU Keyframe (SDXL on RunPod)");
    expect(body.name).toBe("keyframe");
  });

  it("configured: reports configured:true (POSITIVE CONTROL -- the flag discriminates)", async () => {
    const body = await moduleJson(CONFIGURED);
    expect(body.configured).toBe(true);
    expect((body.provides as { label: string }[])[0].label).toBe("GPU Keyframe (SDXL on RunPod)");
  });
});

describe("the panel hide holds end-to-end through the registry choke point", () => {
  it("unconfigured keyframe is DROPPED by filterConfiguredModules", async () => {
    const unconfigured = (await moduleJson({})) as unknown as RegisteredModule;
    const other = { name: "local-gpu", hooks: ["keyframe"] } as unknown as RegisteredModule;
    const kept = filterConfiguredModules([unconfigured, other]).map((m) => m.name);
    expect(kept).toEqual(["local-gpu"]);
    expect(kept).not.toContain("keyframe");
  });

  it("configured keyframe is KEPT (the hide is credential-driven, not unconditional)", async () => {
    const configured = (await moduleJson(CONFIGURED)) as unknown as RegisteredModule;
    const kept = filterConfiguredModules([configured]).map((m) => m.name);
    expect(kept).toEqual(["keyframe"]);
  });
});

describe("routing of non-manifest paths is unchanged", () => {
  it("unconfigured: /invoke still reaches the mock (the dev affordance survives the hide)", async () => {
    const { app, store } = sidecar({});
    const res = await app.fetch(
      new Request("https://module/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook: "keyframe",
          input: { project: "p1", bundle_key: "bundles/p1.tar.gz", shot_ids: ["s1"] },
        }),
      }),
    );
    const body = (await res.json()) as { ok: boolean; output?: { keyframes: { keyframe_key: string }[] } };
    expect(body.ok).toBe(true);
    expect(body.output?.keyframes[0].keyframe_key).toBe("renders/p1/keyframes/s1.png");
    expect(store.keys).toEqual(["renders/p1/keyframes/s1.png"]); // the mock, provably, wrote it
  });

  it("configured: /invoke goes to RunPod, NOT the mock", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL) => {
        seen.push(String(input instanceof Request ? input.url : input));
        return new Response(JSON.stringify({ id: "job-1", status: "IN_QUEUE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { app, store } = sidecar(CONFIGURED);
    await app.fetch(
      new Request("https://module/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook: "keyframe",
          input: { project: "p1", bundle_key: "bundles/p1.tar.gz", shot_ids: ["s1"] },
        }),
      }),
    );
    // The discriminator: the RunPod path talks to RunPod; the mock path writes an artifact.
    expect(seen.some((u) => u.includes("runpod.ai"))).toBe(true);
    expect(store.keys).toEqual([]);
  });
});
