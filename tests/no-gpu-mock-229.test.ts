// local#229: NOTHING in this repo fabricates a render artifact.
//
// The defect these tests pin, in Conrad's words: "I don't want the fake 'finish film' image that I
// started with local-gpu. The module shouldn't be installed and there should be no functions like
// that." A bare `compose up` left LOCAL_BACKEND_URL empty, `scripts/local-gpu-module-server.ts`
// passed the REAL artifact store in as a mock store unconditionally, and the sidecar answered
// /invoke with a 1x1 red PNG per keyframe and a black 320x240 clip per shot -- under the manifest
// label "Local GPU Keyframe (SDXL on your own card)", reported COMPLETED. The film that came out was
// assembled, honestly, from fabricated frames.
//
// This file covers the DELETION of the fabricators and the RunPod credential seam. The doorless case
// is no longer tested here, because there is no longer a doorless local-gpu app to test: local#280
// gated the module out of the stack entirely (tests/localgpu-lane-280.test.ts). This file's earlier
// assertions that an unconfigured sidecar self-reports `configured: false` were rewritten there --
// Conrad rejected that design: "We shouldn't have to build a shim for a module that isn't even there."
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Hono } from "hono";
import type { RegisteredModule } from "@skyphusion-labs/vivijure-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalGpuModuleApp } from "../src/modules/local-gpu/app.js";
import type { LocalGpuEnv } from "../src/modules/local-gpu/handlers.js";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import type { RunpodModuleEnv } from "../src/modules/runpod/env.js";
import { filterConfiguredModules } from "../src/module-registry.js";

// The SHIPPED manifests, not stubs: the mock served these files verbatim, so a hand-written fixture
// could agree with the bug.
function manifest(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "dev/manifests", `${name}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

const DOOR_CONFIGURED: LocalGpuEnv = { LOCAL_BACKEND_URL: "http://door:8080" };
const RUNPOD_CONFIGURED: RunpodModuleEnv = { RUNPOD_API_KEY: "k", KEYFRAME_RUNPOD_ENDPOINT_ID: "ep" };

const KEYFRAME_INVOKE = {
  hook: "keyframe",
  input: { project: "p1", bundle_key: "bundles/p1.tar.gz", shot_ids: ["s1"] },
  context: { project: "p1" },
};

const MOTION_INVOKE = {
  hook: "motion.backend",
  input: { shot_id: "s1", prompt: "a wide shot of the ocean at dusk", seconds: 4 },
  context: { project: "p1" },
};

async function invoke(app: Hono, body: unknown): Promise<Response> {
  return await app.fetch(
    new Request("https://module/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function moduleJson(app: Hono): Promise<Record<string, unknown>> {
  const res = await app.fetch(new Request("https://module/module.json"));
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local-gpu with a real door (local#229 positive control)", () => {
  const app = (env: LocalGpuEnv) => createLocalGpuModuleApp(manifest("local-gpu"), async () => env);

  it("TALKS TO THE DOOR and fabricates nothing", async () => {
    // The mock deletion has to leave the genuine path untouched, or the fix is just a feature
    // deletion. Every outbound call is recorded so "went to the door" is proven, not assumed.
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string | URL) => {
        seen.push(String(input instanceof Request ? input.url : input));
        // Alphanumeric: door job ids are uuid4.hex and SAFE_JOB_ID rejects anything else.
        return new Response(JSON.stringify({ id: "job1", status: "IN_QUEUE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const configured = app(DOOR_CONFIGURED);

    const res = await invoke(configured, MOTION_INVOKE);
    const body = (await res.json()) as { ok: boolean; pending?: boolean; jobId?: string };
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("job1");
    expect(seen.some((u) => u.startsWith("http://door:8080/"))).toBe(true);
  });

  it("serves the real manifest and self-reports NO `configured` field (local#280)", async () => {
    // A module that is in the stack is installed, full stop. The removed `configured: false` branch
    // was the shim Conrad rejected; asserting the key is absent is what keeps it from creeping back.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const body = await moduleJson(app(DOOR_CONFIGURED));
    expect(Object.keys(body)).not.toContain("configured");
    // CONTROL: the shipped manifest, not an empty object that would satisfy the above vacuously.
    expect((body.provides as { label: string }[])[1].label).toBe("Keyframes on your own GPU");
    expect(body.name).toBe("local-gpu");
    // Kept by the registry filter for the same reason: nothing here asks to be hidden.
    const kept = filterConfiguredModules([body as unknown as RegisteredModule]).map((m) => m.name);
    expect(kept).toEqual(["local-gpu"]);
  });
});

describe("runpod keyframe with no credentials (local#223 seam, mock now deleted)", () => {
  const app = (env: RunpodModuleEnv) => createRunpodModuleApp(manifest("keyframe"), "keyframe", async () => env);

  it("still reports configured:false and is still hidden", async () => {
    const body = await moduleJson(app({}));
    expect(body.configured).toBe(false);
    expect((body.provides as { label: string }[])[0].label).toBe("GPU Keyframe (SDXL on RunPod)");
    const kept = filterConfiguredModules([body as unknown as RegisteredModule]).map((m) => m.name);
    expect(kept).toEqual([]);
  });

  it("/invoke REFUSES instead of reaching the mock", async () => {
    // local#223 deliberately kept the mock reachable on non-manifest paths as a "dev affordance".
    // local#229 removes that: a hidden module that still fabricates output on direct call is one
    // misrouted request away from being the same bug again.
    const res = await invoke(app({}), KEYFRAME_INVOKE);
    const body = (await res.json()) as { ok: boolean; error?: string; output?: unknown };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not configured/i);
    expect(body.output).toBeUndefined();
  });

  it("configured: /invoke goes to RunPod (POSITIVE CONTROL -- the opt-in still works)", async () => {
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
    await invoke(app(RUNPOD_CONFIGURED), KEYFRAME_INVOKE);
    expect(seen.some((u) => u.includes("runpod.ai"))).toBe(true);
  });
});

describe("the fabricating helpers are GONE from the source tree", () => {
  // Conrad asked for the functions deleted, not flagged off. A grep-shaped test is the only thing
  // that catches a reintroduction: any future mock branch has to import from somewhere, and these
  // are the modules it would import.
  it.each([
    "../src/modules/dev/gpu-mock-handlers.js",
    "../src/modules/dev/gpu-mock-app.js",
    "../src/modules/runpod/keyframe-sidecar.js",
  ])("%s no longer exists", async (spec) => {
    await expect(import(spec)).rejects.toThrow();
  });

  it("minimal-media no longer exports fabricated render artifacts", async () => {
    const mod = (await import("../src/dev/minimal-media.js")) as Record<string, unknown>;
    expect(mod.MIN_PNG).toBeUndefined();
    expect(mod.buildStructuralMp4).toBeUndefined();
    // The silent-dialogue fallback (#50) is a DIFFERENT thing and stays: it writes real silence and
    // tags it honestly, rather than passing itself off as a render.
    expect(typeof mod.buildSilentWav).toBe("function");
  });
});
