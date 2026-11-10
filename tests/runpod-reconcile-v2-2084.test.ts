// fleet-chezmoi#2084: vivijure-local's RunPod sidecar restores workersMax before a /run through
// core's reconcileRunpodEndpointWorkersMax (src/modules/runpod/shared.ts). RunPod REST v1
// (rest.runpod.io/v1) retires 2026-11-15; core 1.44.0 (vivijure-core#529) moves the reconcile to
// GET / PATCH https://api.runpod.io/v2/serverless/{id} with the bounds nested under `workers`.
//
// This drives the sidecar's real POST /invoke for keyframe, own-gpu and finish-upscale with
// RUNPOD_WORKERS_MAX set, against an endpoint the stub reports idle-scaled (workers.max 0), and
// asserts the exact v2 calls before the /run. It is RED on core 1.43.0 (the v1 call goes to
// rest.runpod.io with a flat body) and GREEN on 1.44.0.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createRunpodModuleApp } from "../src/modules/runpod/app.js";
import type { RunpodModuleEnv } from "../src/modules/runpod/env.js";

const EP = "ep2084local";
/** A literal, never built from core's constant: a constant-derived URL follows any wrong value. */
const V2_URL = "https://api.runpod.io/v2/serverless/" + EP;

const ENV: RunpodModuleEnv = {
  RUNPOD_API_KEY: "rpa_local_2084",
  RUNPOD_ENDPOINT_ID: EP,
  KEYFRAME_RUNPOD_ENDPOINT_ID: EP,
  BACKEND_RUNPOD_ENDPOINT_ID: EP,
  VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID: EP,
  RUNPOD_WORKERS_MAX: "3",
};

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

function stubFetch(): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === V2_URL && method === "GET") {
        return Response.json({ id: EP, name: "probe", workers: { min: 0, max: 0 } });
      }
      if (url === V2_URL && method === "PATCH") {
        return Response.json({ id: EP, name: "probe", workers: { min: 0, max: 3 } });
      }
      return Response.json({ id: "job-2084", status: "IN_QUEUE" });
    }),
  );
  return calls;
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

const FINISH_INPUT = { shot_id: "shot_01", clip_key: "renders/p/clips/shot_01.mp4", src_fps: 24, frames: 48 };

const CASES: Array<{ name: string; body: unknown }> = [
  {
    name: "keyframe",
    body: { hook: "keyframe", input: { project: "p", bundle_key: "bundles/p-1.tar.gz" }, config: {}, context: { project: "p", job_id: "j" } },
  },
  {
    name: "own-gpu",
    body: {
      hook: "motion.backend",
      input: { shot_id: "shot_01", prompt: "a probe", keyframe_url: "https://example.invalid/kf.png" },
      config: {},
      context: { project: "p", job_id: "j" },
    },
  },
  {
    name: "finish-upscale",
    body: { hook: "finish", input: FINISH_INPUT, config: {}, context: { project: "p", job_id: "j" } },
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("fleet-chezmoi#2084: the local RunPod sidecar reconcile goes to RunPod REST v2", () => {
  for (const c of CASES) {
    it(`${c.name}: GET then PATCH ${V2_URL} with the nested workers body, then /run`, async () => {
      const calls = stubFetch();
      const app = createRunpodModuleApp({ name: c.name }, c.name, async () => ENV);
      const res = await app.fetch(
        new Request("https://module/invoke", { method: "POST", body: JSON.stringify(c.body) }),
      );
      const out = (await res.json()) as { ok: boolean; error?: string };
      expect(out.error ?? "", `${c.name} invoke error`).toBe("");

      const mgmt = calls.filter((x) => hostOf(x.url) === "api.runpod.io");
      expect(mgmt.map((x) => [x.method, x.url]), `${c.name} management calls`).toEqual([
        ["GET", V2_URL],
        ["PATCH", V2_URL],
      ]);
      expect(JSON.parse(mgmt[1].body ?? "null")).toEqual({ workers: { max: 3, min: 0 } });
      // The retired host is never reached, and the submit still goes to the serverless invoke API.
      expect(calls.some((x) => hostOf(x.url) === "rest.runpod.io")).toBe(false);
      const run = calls.findIndex((x) => x.url.endsWith("/run"));
      expect(run, `${c.name} issued no /run`).toBeGreaterThan(-1);
      expect(hostOf(calls[run].url)).toBe("api.runpod.ai");
      // Order: the restore happens BEFORE the submit, or a cold endpoint takes the job with no workers.
      expect(calls.findIndex((x) => x.method === "PATCH")).toBeLessThan(run);
    });
  }
});
