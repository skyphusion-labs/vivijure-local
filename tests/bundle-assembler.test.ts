import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  assembleBundle,
  decodeDataUrl,
  detectImageExt,
  safeCharFilename,
} from "@skyphusion-labs/vivijure-core/bundle-assembler";
import { validateStoryboard } from "@skyphusion-labs/vivijure-core/storyboard-validate";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { wrapR2Bucket } from "../src/platform/r2-adapter.js";
import { LocalObjectPresigner } from "../src/platform/storage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_PNG } from "../src/dev/minimal-media.js";

const STORYBOARD = {
  title: "bundle_smoke",
  full_prompt: "A short test film for bundle assembly.",
  duration_seconds: 8,
  clip_seconds: 4,
  style_prefix: "cinematic",
  style_category: "None",
  style_preset: "None",
  use_characters: [] as string[],
  scenes: [
    { id: "shot_01", prompt: "a wide shot of the ocean at dusk" },
    { id: "shot_02", prompt: "waves on a dark beach" },
  ],
};

describe("bundle-assembler pure helpers", () => {
  it("safeCharFilename mirrors the GPU worker convention", () => {
    expect(safeCharFilename("A", "Neon Runner")).toBe("char_A_Neon_Runner.png");
  });

  it("decodeDataUrl round-trips MIN_PNG", () => {
    const url = `data:image/png;base64,${Buffer.from(MIN_PNG).toString("base64")}`;
    const bytes = decodeDataUrl(url);
    expect(bytes?.length).toBe(MIN_PNG.length);
    expect(detectImageExt(bytes!)).toBe("png");
  });
});

describe("assembleBundle", () => {
  let dir: string;
  let env: OrchestratorEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-bundle-"));
    const store = new FilesystemObjectStore(join(dir, "renders"));
    env = {
      DB: {} as OrchestratorEnv["DB"],
      R2_RENDERS: wrapR2Bucket(store),
      R2: wrapR2Bucket(store),
      PRESIGNER: new LocalObjectPresigner("http://127.0.0.1:8790", "x".repeat(64)),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assembles a character-free bundle tar.gz into R2", async () => {
    const validated = validateStoryboard(STORYBOARD);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await assembleBundle(env, {
      storyboard: validated.value,
      characterRefs: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundleKey).toMatch(/^bundles\/bundle_smoke-[0-9a-f]{16}\.tar\.gz$/);
    expect(result.fileCount).toBeGreaterThan(0);
    const obj = await env.R2_RENDERS.get(result.bundleKey);
    expect(obj).not.toBeNull();
  });
});
