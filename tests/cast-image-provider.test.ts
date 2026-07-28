import { describe, expect, it, vi, afterEach } from "vitest";
import {
  pickCastImageProvider,
  resolveCastImageModel,
  generateCastImageViaProvider,
  workersAiCastConfigured,
} from "../src/modules/chain/cast-image-provider.js";
import { LOCAL_CAST_MODEL } from "../src/modules/chain/cast-image-local.js";
import * as castLocal from "../src/modules/chain/cast-image-local.js";
import * as castGen from "../src/modules/chain/cast-image-gen.js";
import * as ollama from "../src/modules/chain/ollama.js";

describe("cast.image provider pick (local#269)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks local when CAST_IMAGE_BACKEND_URL is set (homelab first-win)", () => {
    expect(
      pickCastImageProvider({ CAST_IMAGE_BACKEND_URL: "http://cast-image:8785" }, undefined),
    ).toBe("local");
  });

  it("picks local for local/* model ids when backend URL is set", () => {
    expect(
      pickCastImageProvider(
        { CAST_IMAGE_BACKEND_URL: "http://127.0.0.1:8785" },
        "local/flux-2-klein-4b",
      ),
    ).toBe("local");
  });

  it("routes explicit @cf/ to workers-ai when CF creds exist even if local URL is set", () => {
    expect(
      pickCastImageProvider(
        {
          CAST_IMAGE_BACKEND_URL: "http://cast-image:8785",
          CLOUDFLARE_ACCOUNT_ID: "acct",
          CF_AIG_TOKEN: "tok",
        },
        "@cf/black-forest-labs/flux-2-klein-4b",
      ),
    ).toBe("workers-ai");
  });

  it("falls back to local when UI sends @cf/ but only local backend is configured", () => {
    expect(
      pickCastImageProvider(
        { CAST_IMAGE_BACKEND_URL: "http://cast-image:8785" },
        "@cf/black-forest-labs/flux-2-klein-9b",
      ),
    ).toBe("local");
  });

  it("picks workers-ai when only CF creds are set", () => {
    expect(
      pickCastImageProvider(
        { CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_TOKEN: "tok" },
        "@cf/black-forest-labs/flux-2-klein-4b",
      ),
    ).toBe("workers-ai");
  });

  it("resolves default local model id for Apache path", () => {
    const r = resolveCastImageModel({ CAST_IMAGE_BACKEND_URL: "http://cast-image:8785" });
    expect(r.provider).toBe("local");
    expect(r.model).toBe(LOCAL_CAST_MODEL);
  });

  it("workersAiCastConfigured requires account + token", () => {
    expect(workersAiCastConfigured({})).toBe(false);
    expect(workersAiCastConfigured({ CLOUDFLARE_ACCOUNT_ID: "a" })).toBe(false);
    expect(
      workersAiCastConfigured({ CLOUDFLARE_ACCOUNT_ID: "a", CF_AIG_TOKEN: "t" }),
    ).toBe(true);
  });

  it("generate via local calls backend and unloads Ollama first", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const unloadOllama = vi.spyOn(ollama, "ensureOllamaUnloadedForGpu").mockResolvedValue(true);
    vi.spyOn(castLocal, "callLocalCastImage").mockResolvedValue({
      bytes: fakePng,
      mime: "image/png",
    });

    const out = await generateCastImageViaProvider(
      {
        CAST_IMAGE_BACKEND_URL: "http://cast-image:8785",
        OLLAMA_BASE_URL: "http://ollama:11434",
      },
      "local/flux-2-klein-4b",
      "close-up portrait",
      ["https://example.com/p.png"],
    );

    expect(unloadOllama).toHaveBeenCalled();
    expect(out.provider).toBe("local");
    expect(out.model).toBe(LOCAL_CAST_MODEL);
    expect(out.bytes).toEqual(fakePng);
  });

  it("fail path: neither local nor CF configured", async () => {
    await expect(
      generateCastImageViaProvider({}, "local/flux-2-klein-4b", "prompt", []),
    ).rejects.toThrow(/CAST_IMAGE_BACKEND_URL|no provider configured/i);
  });

  it("fail path: workers-ai without creds", async () => {
    await expect(
      generateCastImageViaProvider({}, "@cf/black-forest-labs/flux-2-klein-4b", "prompt", []),
    ).rejects.toThrow(/no provider configured/i);
  });

  it("workers-ai path calls generateCastImageWorkersAi when CF configured", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const spy = vi.spyOn(castGen, "generateCastImageWorkersAi").mockResolvedValue({
      bytes: fakePng,
      mime: "image/png",
    });

    const out = await generateCastImageViaProvider(
      { CLOUDFLARE_ACCOUNT_ID: "acct", CF_AIG_TOKEN: "tok" },
      "@cf/black-forest-labs/flux-2-klein-4b",
      "prompt",
      [],
    );

    expect(spy).toHaveBeenCalled();
    expect(out.provider).toBe("workers-ai");
    expect(out.model).toBe("@cf/black-forest-labs/flux-2-klein-4b");
  });
});
