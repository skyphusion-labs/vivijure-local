import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { invokeCastImage, pollCastImage } from "../src/modules/chain/handlers.js";
import * as castImageGen from "../src/modules/chain/cast-image-gen.js";
import { isFlaggedError } from "../src/modules/chain/cast-image-core.js";

describe("cast.image core", () => {
  it("detects safety-flag errors", () => {
    expect(isFlaggedError("error 3030 flagged")).toBe(true);
    expect(isFlaggedError("has been flagged by safety")).toBe(true);
    expect(isFlaggedError("network timeout")).toBe(false);
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
    vi.spyOn(castImageGen, "generateCastImage").mockResolvedValue({
      bytes: fakePng,
      mime: "image/png",
    });

    const invoke = await invokeCastImage(store, {
      hook: "cast.image",
      input: {
        cast_id: 42,
        portrait_url: "https://example.com/portrait.png",
        bible: "a test pilot",
      },
      config: { model: "@cf/black-forest-labs/flux-2-klein-9b", num_images: 4 },
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
    expect(castImageGen.generateCastImage).toHaveBeenCalledWith(
      env,
      "@cf/black-forest-labs/flux-2-klein-9b",
      expect.stringContaining("close-up portrait"),
      ["https://example.com/portrait.png"],
    );
  });

  it("falls back to nano-banana on safety flag", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const gen = vi
      .spyOn(castImageGen, "generateCastImage")
      .mockRejectedValueOnce(new Error("3030 has been flagged"))
      .mockResolvedValue({ bytes: fakePng, mime: "image/png" });

    const invoke = await invokeCastImage(store, {
      hook: "cast.image",
      input: { cast_id: 7, portrait_url: "https://example.com/p.png" },
      config: { num_images: 4 },
      context: { project: "p", job_id: "j1" },
    });
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected poll");

    const poll = await pollCastImage(env, store, { poll: invoke.poll });
    expect(poll.ok).toBe(true);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1]?.[1]).toBe("google/nano-banana-pro");
  });
});
