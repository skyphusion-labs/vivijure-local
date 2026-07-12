import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipBytes } from "@skyphusion-labs/vivijure-core/bundle-assembler";
import type {
  InvokeRequest,
  InvokeResponse,
  KeyframeInput,
  KeyframeOutput,
  MotionBackendInput,
  MotionBackendOutput,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core";
import { parseStoryboardScenes } from "@skyphusion-labs/vivijure-core/planner-yaml";
import { readTar } from "@skyphusion-labs/vivijure-core/tar";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { MIN_PNG, buildStructuralMp4 } from "../../dev/minimal-media.js";

const execFileAsync = promisify(execFile);

export type GpuMockModuleName = "keyframe" | "local-gpu";

export function isGpuMockModuleName(name: string): name is GpuMockModuleName {
  return name === "keyframe" || name === "local-gpu";
}

async function writeFfmpegClip(store: ArtifactStore, clipKey: string, seconds: number): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "vj-mock-clip-"));
  const outPath = join(dir, "clip.mp4");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=320x240:d=${Math.max(0.5, seconds)}`,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    const bytes = new Uint8Array(await readFile(outPath));
    await store.put(clipKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeMockClip(
  store: ArtifactStore,
  clipKey: string,
  seconds: number,
): Promise<void> {
  try {
    await writeFfmpegClip(store, clipKey, seconds);
    return;
  } catch {
    const fallback = buildStructuralMp4(seconds);
    await store.put(clipKey, fallback, { httpMetadata: { contentType: "video/mp4" } });
  }
}

async function shotIdsFromBundle(store: ArtifactStore, bundleKey: string): Promise<string[]> {
  const obj = await store.get(bundleKey);
  if (!obj) return [];
  const tarBytes = await gunzipBytes(new Uint8Array(obj));
  for (const e of readTar(tarBytes)) {
    if (e.name === "storyboard.yaml") {
      return parseStoryboardScenes(new TextDecoder().decode(e.content)).map((s) => s.shot_id);
    }
  }
  return [];
}

export async function invokeKeyframeMock(
  store: ArtifactStore,
  req: InvokeRequest<KeyframeInput>,
): Promise<InvokeResponse<KeyframeOutput>> {
  const input = req.input;
  if (!input?.project || !input.bundle_key) {
    return { ok: false, error: "keyframe: input needs project and bundle_key" };
  }
  const wanted = input.shot_ids?.length ? input.shot_ids : await shotIdsFromBundle(store, input.bundle_key);
  if (!wanted.length) {
    return { ok: false, error: "keyframe: bundle has no scenes" };
  }
  const keyframes = [];
  for (const shot_id of wanted) {
    const keyframe_key = `renders/${input.project}/keyframes/${shot_id}.png`;
    await store.put(keyframe_key, MIN_PNG, { httpMetadata: { contentType: "image/png" } });
    keyframes.push({ shot_id, keyframe_key });
  }
  return { ok: true, output: { project: input.project, keyframes } };
}

export async function invokeLocalGpuMock(
  store: ArtifactStore,
  req: InvokeRequest<MotionBackendInput>,
): Promise<InvokeResponse<MotionBackendOutput>> {
  const input = req.input;
  const project = req.context?.project;
  if (!input?.shot_id || !input.prompt || !project) {
    return { ok: false, error: "motion.backend: input needs shot_id, prompt, and context.project" };
  }
  const seconds = Number(input.seconds) > 0 ? Number(input.seconds) : 4;
  const clip_key = `renders/${project}/clips/${input.shot_id}_local-gpu.mp4`;
  await writeMockClip(store, clip_key, seconds);
  const frames = Math.max(24, Math.round(seconds * 24));
  return {
    ok: true,
    output: { shot_id: input.shot_id, clip_key, fps: 24, frames },
  };
}

export async function pollLocalGpuMock(_body: PollRequest): Promise<PollResponse<MotionBackendOutput>> {
  return { ok: false, error: "local-gpu mock completes synchronously on /invoke" };
}
