import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvokeRequest, ScoreInput } from "@skyphusion-labs/vivijure-core";
import { invokeMusicGen, pollMusicGen } from "../src/modules/score/handlers.js";
import * as aiRunMod from "../src/platform/ai-run.js";
import * as stateMod from "../src/modules/score/music-gen-state.js";

const baseEnv = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  GATEWAY_ID: "vivijure",
  CF_AIG_TOKEN: "tok",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_BUCKET: "vivijure",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
};

function scoreReq(overrides?: Partial<InvokeRequest<ScoreInput>>): InvokeRequest<ScoreInput> {
  return {
    hook: "score",
    input: { film_key: "audio-bed/planner", seconds: 60 },
    config: { prompt: "gentle strings" },
    context: { job_id: "job-1", project: "planner" },
    ...overrides,
  };
}

describe("music-gen handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("invoke skips when gateway is not configured", async () => {
    const r = await invokeMusicGen({} as typeof baseEnv, scoreReq());
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      expect(r.output.applied).toContain("music-gen:skipped-no-gateway");
    }
  });

  it("invoke returns pending poll token and writes running state", async () => {
    const writeSpy = vi.spyOn(stateMod, "writeMusicState").mockResolvedValue();
    vi.spyOn(aiRunMod, "aiRun").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { audio: "https://example.com/a.mp3" };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://example.com/a.mp3") {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "audio/mpeg" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const r = await invokeMusicGen(baseEnv, scoreReq());
    expect(r.ok).toBe(true);
    if (r.ok && "pending" in r && r.pending) {
      expect(typeof r.poll).toBe("string");
    }
    expect(writeSpy).toHaveBeenCalledWith(
      baseEnv,
      "job-1",
      expect.objectContaining({ status: "running", film_key: "audio-bed/planner" }),
    );
  });

  it("poll surfaces done output from state", async () => {
    vi.spyOn(stateMod, "readMusicState").mockResolvedValue({
      status: "done",
      film_key: "audio-bed/planner",
      audio_key: "out/job-1.mp3",
      mime: "audio/mpeg",
      applied: ["music:minimax/music-2.6", "audio:out/job-1.mp3"],
    });
    const r = await pollMusicGen(baseEnv, { poll: Buffer.from(JSON.stringify({ job_id: "job-1" })).toString("base64") });
    expect(r.ok).toBe(true);
    if (r.ok && "output" in r) {
      expect(r.output.applied).toContain("audio:out/job-1.mp3");
    }
  });

  it("poll surfaces failed state as error", async () => {
    vi.spyOn(stateMod, "readMusicState").mockResolvedValue({
      status: "failed",
      error: "workers ai 500",
      applied: [],
    });
    const r = await pollMusicGen(baseEnv, { poll: Buffer.from(JSON.stringify({ job_id: "job-1" })).toString("base64") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("500");
  });
});
