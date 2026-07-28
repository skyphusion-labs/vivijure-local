import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { invokeCastImage, pollCastImage } from "../src/modules/chain/handlers.js";
import * as castProvider from "../src/modules/chain/cast-image-provider.js";
import { isFlaggedError, DEFAULT_CAST_MODEL, MODELS } from "../src/modules/chain/cast-image-core.js";
import { LOCAL_CAST_MODEL } from "../src/modules/chain/cast-image-local.js";

describe("cast.image core", () => {
  it("detects safety-flag errors", () => {
    expect(isFlaggedError("error 3030 flagged")).toBe(true);
    expect(isFlaggedError("has been flagged by safety")).toBe(true);
    expect(isFlaggedError("network timeout")).toBe(false);
  });

  it("defaults catalog to Apache local Klein 4B (not non-commercial 9b)", () => {
    expect(DEFAULT_CAST_MODEL).toBe(LOCAL_CAST_MODEL);
    expect(MODELS[0]).toBe(LOCAL_CAST_MODEL);
    expect(MODELS).toContain("@cf/black-forest-labs/flux-2-klein-4b");
    expect(MODELS).toContain("@cf/black-forest-labs/flux-2-klein-9b");
  });
});

describe("cast.image poll", () => {
  let dir: string;
  let store: FilesystemObjectStore;
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CF_AIG_TOKEN: "tok",
    GATEWAY_ID: "gw",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-cast-img-"));
    store = new FilesystemObjectStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("generates a real image on poll (mocked model)", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.spyOn(castProvider, "generateCastImageViaProvider").mockResolvedValue({
      bytes: fakePng,
      mime: "image/png",
      model: "@cf/black-forest-labs/flux-2-klein-4b",
      provider: "workers-ai",
    });

    const invoke = await invokeCastImage(env, store, {
      hook: "cast.image",
      input: {
        cast_id: 42,
        portrait_url: "https://example.com/portrait.png",
        bible: "a test pilot",
      },
      config: { model: "@cf/black-forest-labs/flux-2-klein-4b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    });
    expect(invoke.ok).toBe(true);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll token");

    const poll = await pollCastImage(env, store, { poll: invoke.poll });
    expect(poll.ok).toBe(true);
    if (!poll.ok || !("pending" in poll)) throw new Error("expected pending");
    expect(poll.pending).toBe(true);

    const stored = await store.getBytes("cast-gen/42/ref_01.png");
    expect(stored?.bytes.length).toBe(fakePng.length);
    expect(castProvider.generateCastImageViaProvider).toHaveBeenCalledWith(
      env,
      "@cf/black-forest-labs/flux-2-klein-4b",
      expect.stringContaining("close-up portrait"),
      ["https://example.com/portrait.png"],
    );
  });

  it("local first-win: persists local/flux-2-klein-4b when CAST_IMAGE_BACKEND_URL set", async () => {
    const localEnv = { CAST_IMAGE_BACKEND_URL: "http://cast-image:8785" };
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(castProvider, "generateCastImageViaProvider").mockResolvedValue({
      bytes: fakePng,
      mime: "image/png",
      model: LOCAL_CAST_MODEL,
      provider: "local",
    });
    const unload = vi.spyOn(castProvider, "unloadCastImageGpuBestEffort").mockResolvedValue();

    const invoke = await invokeCastImage(localEnv, store, {
      hook: "cast.image",
      // UI may still send a CF id from the image.generate picker; local wins.
      input: { cast_id: 9, portrait_url: "https://example.com/p.png" },
      config: { model: "@cf/black-forest-labs/flux-2-klein-9b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    });
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    // Drain all 4 images so unload runs on completion.
    let poll = await pollCastImage(localEnv, store, { poll: invoke.poll });
    for (let i = 0; i < 6 && poll.ok && "pending" in poll && poll.pending; i++) {
      poll = await pollCastImage(localEnv, store, { poll: invoke.poll });
    }
    expect(poll.ok).toBe(true);
    if (!poll.ok || !("output" in poll)) throw new Error("expected output");
    expect(poll.output.applied.some((a) => a.includes(LOCAL_CAST_MODEL))).toBe(true);
    expect(unload).toHaveBeenCalled();
  });

  it("falls back to nano-banana on safety flag (cloud path only)", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const gen = vi
      .spyOn(castProvider, "generateCastImageViaProvider")
      .mockRejectedValueOnce(new Error("3030 has been flagged"))
      .mockResolvedValue({
        bytes: fakePng,
        mime: "image/png",
        model: "google/nano-banana-pro",
        provider: "workers-ai",
      });

    const invoke = await invokeCastImage(env, store, {
      hook: "cast.image",
      input: { cast_id: 7, portrait_url: "https://example.com/p.png" },
      config: { model: "@cf/black-forest-labs/flux-2-klein-4b", num_images: 4 },
      context: { project: "p", job_id: "j1" },
    });
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    const poll = await pollCastImage(env, store, { poll: invoke.poll });
    expect(poll.ok).toBe(true);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1]?.[1]).toBe("google/nano-banana-pro");
  });

  it("does not nano-banana-fallback on local provider flag errors", async () => {
    vi.spyOn(castProvider, "pickCastImageProvider").mockReturnValue("local");
    const gen = vi
      .spyOn(castProvider, "generateCastImageViaProvider")
      .mockRejectedValue(new Error("3030 has been flagged"));

    const localEnv = { CAST_IMAGE_BACKEND_URL: "http://cast-image:8785" };
    const invoke = await invokeCastImage(localEnv, store, {
      hook: "cast.image",
      input: { cast_id: 3, portrait_url: "https://example.com/p.png" },
      config: { model: LOCAL_CAST_MODEL, num_images: 4 },
      context: { project: "p", job_id: "j1" },
    });
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    const poll = await pollCastImage(localEnv, store, { poll: invoke.poll });
    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error("expected failure");
    expect(poll.error).toMatch(/generation failed/);
    expect(gen).toHaveBeenCalledTimes(1);
  });
});
