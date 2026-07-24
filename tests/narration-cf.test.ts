// local#202: narration-gen tier routing -- creds-free Aura-1 default, RunPod MiniMax opt-in, honest
// degrade when neither is configured. Plus the engine-honest runtime /module.json.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvokeRequest, ScoreInput } from "@skyphusion-labs/vivijure-core";
import { invokeNarrationGen } from "../src/modules/score/handlers.js";
import { createScoreModuleApp } from "../src/modules/score/app.js";
import { NARRATION_HONEST_LABEL } from "../src/modules/score/narration-aura.js";
import * as aiRunMod from "../src/platform/ai-run.js";
import * as storageMod from "../src/modules/runpod/storage.js";

const gatewayEnv = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  GATEWAY_ID: "vivijure",
  CF_AIG_TOKEN: "tok",
};

function narrReq(config?: Record<string, unknown>): InvokeRequest<ScoreInput> {
  return {
    hook: "score",
    input: { film_key: "audio-bed/planner", seconds: 60 },
    config: { text: "Once upon a time in a quiet town.", ...(config ?? {}) },
    context: { job_id: "job-1", project: "planner" },
  };
}

describe("invokeNarrationGen tier routing", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("no engine configured -> honest, non-fatal degrade (film ships without narration)", async () => {
    const r = await invokeNarrationGen({} as never, narrReq());
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      expect(r.output.applied).toContain("narration:skipped");
      expect(r.output.degraded).toBeTruthy();
      expect(r.output.film_key).toBe("audio-bed/planner");
    }
  });

  it("CF gateway, no RunPod -> Aura-1 renders creds-free (the default path)", async () => {
    const auraSpy = vi
      .spyOn(aiRunMod, "aiRun")
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
    const putSpy = vi.spyOn(storageMod, "putAudioBytes").mockResolvedValue();

    const r = await invokeNarrationGen(gatewayEnv as never, narrReq({ voice_id: "Wise_Woman" }));
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      expect(r.output.applied).toContain("narration:aura-1");
      expect(r.output.applied.some((t) => t.startsWith("audio:out/narr-job-1"))).toBe(true);
      expect(r.output.degraded).toBeUndefined();
    }
    expect(auraSpy).toHaveBeenCalledWith(
      gatewayEnv,
      "@cf/deepgram/aura-1",
      expect.objectContaining({ encoding: "mp3", speaker: expect.any(String) }),
    );
    expect(putSpy).toHaveBeenCalledWith(gatewayEnv, "out/narr-job-1.mp3", expect.any(Uint8Array), "audio/mpeg");
  });

  it("Aura path names the degrade when a MiniMax-only knob is set (never silent)", async () => {
    vi.spyOn(aiRunMod, "aiRun").mockResolvedValue(new Uint8Array([1]).buffer);
    vi.spyOn(storageMod, "putAudioBytes").mockResolvedValue();
    const r = await invokeNarrationGen(gatewayEnv as never, narrReq({ emotion: "happy" }));
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      expect(r.output.applied).toContain("narration:aura-1");
      expect(r.output.degraded).toContain("emotion");
    }
  });

  it("RUNPOD_API_KEY present -> the MiniMax HD tier (async poll), Aura NOT called", async () => {
    const auraSpy = vi.spyOn(aiRunMod, "aiRun");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "rp-job-9" }), { status: 200 })),
    );
    const r = await invokeNarrationGen({ RUNPOD_API_KEY: "k" } as never, narrReq());
    expect(r.ok).toBe(true);
    if (r.ok && "pending" in r) {
      expect(r.pending).toBe(true);
      expect(typeof r.poll).toBe("string");
    }
    expect(auraSpy).not.toHaveBeenCalled();
  });
});

describe("score /module.json is engine-honest for narration-gen", () => {
  const manifest = { name: "narration-gen", provides: [{ id: "minimax-speech", label: "MiniMax Speech 02 HD (RunPod)" }] };
  async function moduleJson(env: Record<string, unknown>): Promise<Record<string, unknown>> {
    const app = createScoreModuleApp(manifest, "narration-gen", async () => env as never);
    const res = await app.fetch(new Request("https://module/module.json"));
    return (await res.json()) as Record<string, unknown>;
  }

  it("CF gateway only -> honest label + narration_engine aura-1", async () => {
    const m = await moduleJson(gatewayEnv);
    expect((m.provides as Array<{ label: string }>)[0].label).toBe(NARRATION_HONEST_LABEL);
    expect(m.narration_engine).toBe("aura-1");
    expect(Array.isArray(m.narration_tiers)).toBe(true);
  });
  it("RunPod key -> narration_engine minimax-runpod", async () => {
    const m = await moduleJson({ ...gatewayEnv, RUNPOD_API_KEY: "k" });
    expect(m.narration_engine).toBe("minimax-runpod");
  });
  it("music-gen is untouched (control: raw manifest, no engine fields)", async () => {
    const app = createScoreModuleApp({ name: "music-gen", provides: [{ label: "MiniMax Music" }] }, "music-gen", async () => ({}) as never);
    const res = await app.fetch(new Request("https://module/module.json"));
    const m = (await res.json()) as Record<string, unknown>;
    expect(m.narration_engine).toBeUndefined();
    expect((m.provides as Array<{ label: string }>)[0].label).toBe("MiniMax Music");
  });
});
