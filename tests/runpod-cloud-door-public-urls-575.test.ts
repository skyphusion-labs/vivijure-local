// local#575: the RunPod public-endpoint cloud i2v doors hand the provider URLs it FETCHES over the
// internet (the keyframe, the end keyframe, driving audio). A loopback, private or .local URL cannot be
// fetched, and the paid job would fail at the provider. They now refuse BEFORE submitting, with
// not-configured and the fix named, the same check as the hosted gateway doors (#568). No spend:
// fetch is stubbed and must not be called on a refusal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_MOTION, invokeFixedMotion } from "../src/modules/runpod/fixed-motion.js";
import { bodyUrlRefusal } from "../src/modules/gateway-i2v/keyframe-host.js";

const ENV = { RUNPOD_API_KEY: "rp-test" } as never;
const PUBLIC = "https://media.example.com/k.png";
let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    calls.push(String(u));
    return new Response(JSON.stringify({ id: "job-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function req(input: Record<string, unknown>) {
  return { hook: "motion.backend", input: { shot_id: "s1", prompt: "a lighthouse", seconds: 5, ...input }, config: {}, context: { project: "p", job_id: "j" } } as never;
}

describe("RunPod cloud doors refuse an unfetchable URL before submit (local#575)", () => {
  const doors = Object.keys(FIXED_MOTION);
  it("covers every fixed-endpoint cloud door", () => {
    expect(doors.sort()).toEqual(["alibaba-wan", "alibaba-wan-lora", "google-veo", "minimax-hailuo", "seedance"]);
  });

  it.each(doors)("%s: a loopback keyframe is refused, nothing submitted", async (name) => {
    const r = await invokeFixedMotion(ENV, name, req({ keyframe_url: "http://127.0.0.1:8790/k.png" }));
    expect(r).toMatchObject({ ok: false, reason: "not-configured" });
    expect((r as { error: string }).error).toMatch(/S3_PRESIGN_ENDPOINT.*docs\/EDGE\.md/);
    expect(calls).toEqual([]);
  });

  it.each(doors)("%s: a public keyframe is submitted", async (name) => {
    const r = await invokeFixedMotion(ENV, name, req({ keyframe_url: PUBLIC }));
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/run$/);
  });

  it("alibaba-wan: private driving audio is refused and named", async () => {
    const r = await invokeFixedMotion(ENV, "alibaba-wan", req({ keyframe_url: PUBLIC, audio_url: "http://192.168.1.20:9000/line.wav" }));
    expect(r).toMatchObject({ ok: false, reason: "not-configured" });
    expect((r as { error: string }).error).toMatch(/the audio URL host "192\.168\.1\.20"/);
    expect(calls).toEqual([]);
  });

  it("a .local keyframe and an RFC1918 keyframe are refused", async () => {
    for (const u of ["http://nas.local:9000/k.png", "http://10.20.30.40/k.png"]) {
      const r = await invokeFixedMotion(ENV, "seedance", req({ keyframe_url: u }));
      expect(r).toMatchObject({ ok: false, reason: "not-configured" });
    }
    expect(calls).toEqual([]);
  });
});

describe("bodyUrlRefusal", () => {
  it("names the field, walks nesting, ignores non-URLs and data: URIs", () => {
    expect(bodyUrlRefusal({ image: PUBLIC, prompt: "http is a word" })).toBeNull();
    expect(bodyUrlRefusal({ image: "data:image/png;base64,AAAA" })).toBeNull();
    expect(bodyUrlRefusal({ image: "http://localhost/k.png" })).toMatch(/the image URL host "localhost"/);
    expect(bodyUrlRefusal({ loras: [{ path: "http://172.16.0.9/l.safetensors" }] })).toMatch(/the path URL host/);
  });
});
