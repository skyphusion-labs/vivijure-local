import { describe, expect, it, vi } from "vitest";
import { injectVpcFetchers, VpcHttpFetcher, vpcUrlsFromEnv } from "../src/platform/vpc-transport.js";

describe("vpc transport", () => {
  it("maps *_URL env vars to VPC binding names", () => {
    const map = vpcUrlsFromEnv({
      VIDEO_FINISH_URL: "http://127.0.0.1:8780/",
      AUDIO_MIX_URL: "http://127.0.0.1:8783",
      PORT: "8790",
    });
    expect(map.get("VIDEO_FINISH_VPC")).toBe("http://127.0.0.1:8780");
    expect(map.get("AUDIO_MIX_VPC")).toBe("http://127.0.0.1:8783");
    expect(map.has("IMAGE_PREP_VPC")).toBe(false);
  });

  it("rewrites logical VPC hostnames to the configured base URL", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const fetcher = new VpcHttpFetcher("http://video-finish:8000", "video-finish");
    await fetcher.fetch("http://video-finish/finish", { method: "POST", body: "{}" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://video-finish:8000/finish",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    await fetcher.fetch("/health");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://video-finish:8000/health",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
  });

  it("injects fetcher bindings into orchestrator env", () => {
    const env: Record<string, unknown> = {};
    injectVpcFetchers(env, { VIDEO_FINISH_URL: "http://video-finish:8000" });
    expect(env.VIDEO_FINISH_VPC).toBeInstanceOf(VpcHttpFetcher);
  });
});
