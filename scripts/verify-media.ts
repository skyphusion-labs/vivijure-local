/**
 * Download studio artifacts and verify with ffprobe (video-finish / audio-master containers).
 * Used by smoke-exhaustive; never trust COMPLETED without probing bytes.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface VideoExpect {
  label: string;
  minDurationSec?: number;
  maxDurationSec?: number;
  minWidth?: number;
  minHeight?: number;
  expectAudio?: boolean;
  minBytes?: number;
}

export interface AudioExpect {
  label: string;
  minDurationSec?: number;
  minBytes?: number;
}

export interface ProbeResult {
  ok: boolean;
  label: string;
  detail: string;
  probe?: Record<string, unknown>;
}

type FfprobeJson = {
  format?: { duration?: string; size?: string; bit_rate?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
  }>;
};

function repoRoot(): string {
  return join(new URL(".", import.meta.url).pathname, "..");
}

function ffprobeInContainer(container: "video-finish" | "audio-master", remotePath: string): FfprobeJson {
  const child = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      container,
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      remotePath,
    ],
    { cwd: repoRoot(), encoding: "utf8", timeout: 120_000 },
  );
  if (child.status !== 0) {
    throw new Error(
      `ffprobe in ${container} failed: ${(child.stderr || child.stdout || "").trim().slice(0, 400)}`,
    );
  }
  return JSON.parse(child.stdout || "{}") as FfprobeJson;
}

function copyToContainer(container: string, localPath: string, remotePath: string): void {
  const child = spawnSync(
    "docker",
    ["compose", "cp", localPath, `${container}:${remotePath}`],
    { cwd: repoRoot(), encoding: "utf8", timeout: 120_000 },
  );
  if (child.status !== 0) {
    throw new Error(`docker compose cp -> ${container}: ${(child.stderr || child.stdout).trim()}`);
  }
}

async function downloadArtifact(base: string, token: string, key: string, dest: string): Promise<number> {
  const res = await fetch(`${base}/api/artifact/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`GET artifact ${key} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

export async function verifyVideoArtifact(
  base: string,
  token: string,
  key: string,
  expect: VideoExpect,
): Promise<ProbeResult> {
  const dir = mkdtempSync(join(tmpdir(), "vvl-verify-"));
  const local = join(dir, "clip.mp4");
  const remote = "/tmp/vvl-verify.mp4";
  try {
    const sizeBytes = await downloadArtifact(base, token, key, local);
    const minBytes = expect.minBytes ?? 8_000;
    if (sizeBytes < minBytes) {
      return { ok: false, label: expect.label, detail: `too small: ${sizeBytes} bytes (min ${minBytes})` };
    }
    copyToContainer("video-finish", local, remote);
    const json = ffprobeInContainer("video-finish", remote);
    const video = json.streams?.find((s) => s.codec_type === "video");
    const audio = json.streams?.find((s) => s.codec_type === "audio");
    const duration = Number(json.format?.duration ?? video?.duration ?? 0);
    const width = video?.width ?? 0;
    const height = video?.height ?? 0;
    const probe = {
      key,
      sizeBytes,
      duration,
      width,
      height,
      videoCodec: video?.codec_name,
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec_name,
    };

    if (!video) return { ok: false, label: expect.label, detail: "no video stream", probe };
    if (expect.minDurationSec != null && duration < expect.minDurationSec - 0.35) {
      return {
        ok: false,
        label: expect.label,
        detail: `duration ${duration.toFixed(2)}s < min ${expect.minDurationSec}s`,
        probe,
      };
    }
    if (expect.maxDurationSec != null && duration > expect.maxDurationSec + 2) {
      return {
        ok: false,
        label: expect.label,
        detail: `duration ${duration.toFixed(2)}s > max ${expect.maxDurationSec}s`,
        probe,
      };
    }
    if (expect.minWidth != null && width < expect.minWidth) {
      return { ok: false, label: expect.label, detail: `width ${width} < ${expect.minWidth}`, probe };
    }
    if (expect.minHeight != null && height < expect.minHeight) {
      return { ok: false, label: expect.label, detail: `height ${height} < ${expect.minHeight}`, probe };
    }
    if (expect.expectAudio && !audio) {
      return { ok: false, label: expect.label, detail: "expected audio stream, none found", probe };
    }
    if (duration <= 0.1) {
      return { ok: false, label: expect.label, detail: "zero/near-zero duration", probe };
    }
    return {
      ok: true,
      label: expect.label,
      detail: `${width}x${height} ${duration.toFixed(2)}s ${video.codec_name}${audio ? "+audio" : ""} (${sizeBytes} B)`,
      probe,
    };
  } catch (e) {
    return { ok: false, label: expect.label, detail: (e as Error).message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function verifyAudioArtifact(
  base: string,
  token: string,
  key: string,
  expect: AudioExpect,
): Promise<ProbeResult> {
  const dir = mkdtempSync(join(tmpdir(), "vvl-audio-"));
  const local = join(dir, "bed.bin");
  const remote = "/tmp/vvl-verify-audio";
  try {
    const sizeBytes = await downloadArtifact(base, token, key, local);
    const minBytes = expect.minBytes ?? 500;
    if (sizeBytes < minBytes) {
      return { ok: false, label: expect.label, detail: `too small: ${sizeBytes} bytes` };
    }
    copyToContainer("audio-master", local, remote);
    const json = ffprobeInContainer("audio-master", remote);
    const audio = json.streams?.find((s) => s.codec_type === "audio");
    const duration = Number(json.format?.duration ?? audio?.duration ?? 0);
    const probe = { key, sizeBytes, duration, audioCodec: audio?.codec_name };
    if (!audio) return { ok: false, label: expect.label, detail: "no audio stream", probe };
    if (expect.minDurationSec != null && duration < expect.minDurationSec - 0.2) {
      return {
        ok: false,
        label: expect.label,
        detail: `duration ${duration.toFixed(2)}s < min ${expect.minDurationSec}s`,
        probe,
      };
    }
    return {
      ok: true,
      label: expect.label,
      detail: `${duration.toFixed(2)}s ${audio.codec_name} (${sizeBytes} B)`,
      probe,
    };
  } catch (e) {
    return { ok: false, label: expect.label, detail: (e as Error).message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Quick magic-byte check before ffprobe (mp4 ftyp). */
export function sniffMp4(path: string): boolean {
  const head = readFileSync(path).subarray(0, 12);
  return head.length >= 8 && head.slice(4, 8).toString("ascii") === "ftyp";
}
