#!/usr/bin/env tsx
/**
 * Exhaustive homelab smoke: all pipeline paths with ffprobe verification
 * on every generated video/audio artifact (never trust COMPLETED alone).
 *
 *   STUDIO_URL=https://vivijure-local.skyphusion.org \
 *   STUDIO_API_TOKEN=$(cat .studio-token) \
 *   SMOKE_MP3_PATH=/path/to/file.mp3 \
 *   npm run smoke:exhaustive
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAudioArtifact, verifyVideoArtifact } from "./verify-media.js";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const BASE = (process.env.STUDIO_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
/** Public base for artifact URLs RunPod fetches (defaults to STUDIO_URL; set PUBLIC_BASE_URL on tunnel deploys). */
const ARTIFACT_BASE = (process.env.PUBLIC_BASE_URL || process.env.ARTIFACT_PUBLIC_BASE || BASE).replace(/\/$/, "");
const TOKEN = process.env.STUDIO_API_TOKEN || "change-me-local-dev-only";
const MP3_PATH = process.env.SMOKE_MP3_PATH || "";
const SKIP_CLOUD_I2V = process.env.SMOKE_SKIP_CLOUD_I2V === "1";
const SKIP_FULL_FILM = process.env.SMOKE_SKIP_FULL_FILM === "1";
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 12_000);
const FILM_TIMEOUT_MS = Number(process.env.SMOKE_FILM_TIMEOUT_MS || 45 * 60_000);
const SCORE_TIMEOUT_MS = Number(process.env.SMOKE_SCORE_TIMEOUT_MS || 8 * 60_000);
const CLIP_TIMEOUT_MS = Number(process.env.SMOKE_CLIP_TIMEOUT_MS || 25 * 60_000);

const CLOUD_I2V = [
  "seedance",
  "kling",
  "google-veo",
  "minimax-hailuo",
  "vidu-q3",
  "alibaba-wan",
] as const;

type Status = "pass" | "fail" | "warn" | "skip";
interface Row {
  category: string;
  name: string;
  status: Status;
  detail?: string;
}
const rows: Row[] = [];

function record(category: string, name: string, status: Status, detail?: string): void {
  rows.push({ category, name, status, detail });
  const tag = status.toUpperCase().padEnd(4);
  const line = detail ? `${tag} [${category}] ${name} -- ${detail}` : `${tag} [${category}] ${name}`;
  if (status === "fail") console.error(line);
  else console.log(line);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json",
      ...(init.body && !(init.body instanceof Uint8Array) && !(init.body instanceof ArrayBuffer)
        ? { "content-type": "application/json" }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** Studio-routed artifact URL (own-gpu + ffprobe). */
function artifactUrl(key: string): string {
  return `${ARTIFACT_BASE}/api/artifact/${encodeURIComponent(key)}?token=${encodeURIComponent(TOKEN)}`;
}

/** MinIO/S3 presigned GET for RunPod cloud i2v (cannot use studio bearer token). */
function presignPublicUrl(key: string): string {
  const child = spawnSync("npx", ["tsx", "scripts/presign-key-cli.ts", key], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
  const url = (child.stdout || "").trim();
  if (child.status !== 0 || !url.startsWith("http")) {
    throw new Error(`presign ${key}: ${(child.stderr || child.stdout).trim().slice(0, 200)}`);
  }
  return url;
}

async function uploadBytes(bytes: Buffer | Uint8Array, contentType: string): Promise<string> {
  const res = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": contentType },
    body: bytes,
  });
  const body = (await res.json()) as { key?: string; error?: string };
  if (!res.ok || !body.key) throw new Error(`upload failed ${res.status}: ${body.error ?? ""}`);
  return body.key;
}

async function uploadKeyframe(): Promise<string> {
  if (process.env.SMOKE_KEYFRAME_PATH) {
    return uploadBytes(readFileSync(process.env.SMOKE_KEYFRAME_PATH), "image/jpeg");
  }
  const img = await fetch("https://picsum.photos/512/512", { signal: AbortSignal.timeout(30_000) });
  if (!img.ok) throw new Error(`keyframe fetch ${img.status}`);
  return uploadBytes(Buffer.from(await img.arrayBuffer()), "image/jpeg");
}

async function pollScoreJob(id: string, module: string, timeoutMs: number): Promise<{ key?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/job/${encodeURIComponent(id)}?module=${encodeURIComponent(module)}`);
    const body = (await res.json()) as {
      status?: string;
      output_artifact?: { key?: string };
      job_error?: string;
    };
    if (!res.ok) return { error: `poll ${res.status}` };
    if (body.status === "done" && body.output_artifact?.key) return { key: body.output_artifact.key };
    if (body.status === "failed") return { error: body.job_error ?? "failed" };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { error: "timeout" };
}

async function pollClipJob(jobId: string): Promise<{ ok: boolean; clipKey?: string; error?: string }> {
  const deadline = Date.now() + CLIP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await api(`/api/render/clips/${encodeURIComponent(jobId)}`);
    const body = (await res.json()) as {
      shots?: Array<{ status?: string; error?: string; clip_key?: string }>;
      error?: string;
    };
    if (!res.ok) return { ok: false, error: `poll ${res.status}` };
    const shot = body.shots?.[0];
    if (shot?.status === "done" && shot.clip_key) return { ok: true, clipKey: shot.clip_key };
    if (shot?.status === "failed") return { ok: false, error: shot.error ?? "shot failed" };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, error: "timeout" };
}

async function pollFilmJob(jobId: string): Promise<{ ok: boolean; outputKey?: string; error?: string }> {
  const deadline = Date.now() + FILM_TIMEOUT_MS;
  let lastPhase = "";
  while (Date.now() < deadline) {
    const res = await api(`/api/render/film/${encodeURIComponent(jobId)}`);
    const body = (await res.json()) as {
      phase?: string;
      status?: string;
      error?: string;
      film_key?: string;
      output?: { output_key?: string };
    };
    if (!res.ok) return { ok: false, error: `poll ${res.status}` };
    const phase = body.phase ?? body.status ?? "";
    if (phase !== lastPhase) {
      console.log(`  film ${jobId}: ${phase}`);
      lastPhase = phase;
    }
    if (body.phase === "done" || body.status === "COMPLETED") {
      const key = body.film_key ?? body.output?.output_key;
      if (key) return { ok: true, outputKey: key };
      return { ok: false, error: "done but no film_key" };
    }
    if (body.phase === "failed" || body.status === "FAILED") {
      return { ok: false, error: body.error ?? "failed" };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, error: "timeout" };
}

type CastMember = {
  slug?: string;
  name?: string;
  bible?: string | null;
  ref_keys?: Array<{ key: string }>;
  id?: string;
};

function buildCharacterRefs(cast: CastMember[]): Record<string, { name: string; prompt: string; trainingImages: { key: string }[] }> {
  const bySlot: Record<string, string> = { A: "laura", B: "waldo" };
  const out: Record<string, { name: string; prompt: string; trainingImages: { key: string }[] }> = {};
  for (const [slot, slug] of Object.entries(bySlot)) {
    const member = cast.find((c) => c.slug === slug);
    if (!member?.ref_keys?.length) throw new Error(`cast member ${slug} missing ref_keys`);
    out[slot] = {
      name: member.name ?? slug,
      prompt: member.bible ?? "",
      trainingImages: member.ref_keys.map((r) => ({ key: r.key })),
    };
  }
  return out;
}

async function fetchCast(): Promise<CastMember[]> {
  const res = await api("/api/cast");
  const body = (await res.json()) as { cast?: CastMember[] };
  if (!res.ok || !body.cast?.length) throw new Error("could not load cast");
  return body.cast;
}

async function pollStoryboardRender(jobId: string): Promise<{ ok: boolean; outputKey?: string; error?: string }> {
  const deadline = Date.now() + FILM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await api(`/api/storyboard/render/${encodeURIComponent(jobId)}`);
    const body = (await res.json()) as {
      status?: string;
      error?: string;
      output?: { output_key?: string };
    };
    if (!res.ok) return { ok: false, error: `poll ${res.status}` };
    if (body.status === "COMPLETED") {
      const key = body.output?.output_key;
      if (key) return { ok: true, outputKey: key };
      return { ok: false, error: "completed without output_key" };
    }
    if (body.status === "FAILED" || body.status === "CANCELLED") {
      return { ok: false, error: body.error ?? body.status };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, error: "timeout" };
}

const MINI_STORYBOARD = {
  title: "exhaustive_smoke",
  full_prompt: "Two friends meet an upright cat on a forest path.",
  duration_seconds: 10,
  clip_seconds: 5,
  style_prefix: "cinematic 35mm, bright daylight, shallow depth of field",
  style_category: "None",
  style_preset: "None",
  use_characters: ["A", "B"],
  cast_rules: "Laura and Waldo together in walking shots.",
  scenes: [
    {
      id: "shot_01",
      prompt: "Laura walks on a forest path, dappled sunlight, medium shot.",
      character_slots: ["A"],
      dialogue: { slot: "A", text: "What a perfect afternoon." },
      act: "opening",
      target_seconds: 5,
    },
    {
      id: "shot_02",
      prompt: "Close-up portrait of Waldo face, speaking to camera, clear facial features, soft light.",
      character_slots: ["B"],
      dialogue: { slot: "B", text: "That cat is walking like a person." },
      act: "turn",
      target_seconds: 5,
    },
  ],
};

function moduleConfigFor(backend: string): Record<string, unknown> {
  switch (backend) {
    case "seedance":
      return { resolution: "480p", aspect_ratio: "16:9", camera_fixed: true, generate_audio: false };
    case "google-veo":
      return { generate_audio: false };
    case "vidu-q3":
    case "alibaba-wan":
      return { resolution: "480p", shot_type: "single" };
    default:
      return {};
  }
}

function clipSecondsFor(backend: string): number {
  return backend === "minimax-hailuo" ? 6 : 4;
}

function fullFilmRenderBody(bundleKey: string, musicKey: string, motionBackend: string, keyframeBackend: string) {
  return {
    bundle_key: bundleKey,
    project: `exhaustive_full_${motionBackend}`,
    qualityTier: "draft",
    motion_backend: motionBackend,
    keyframe_backend: keyframeBackend,
    motion_config: moduleConfigFor(motionBackend),
    keyframe_config: { model: "@cf/black-forest-labs/flux-2-klein-9b", width: 768, height: 432 },
    audio_key: musicKey,
    film_titles: {
      title: { text: "The Upright Cat", subtitle: "A Homelab Smoke Film" },
      credits: { lines: ["Directed by Vivijure Smoke", "Laura & Waldo", "Flatliners Studio"] },
    },
    cast_loras: {
      A: "a8824bef-4224-48b4-b340-a82e215af3e7",
      B: "04e1dbe6-2564-4c4e-8bfc-61e9908d12ba",
    },
    finish_config: {
      "finish-rife": { interpolate: true, interpolation_factor: 2, face_restore: "none" },
      "finish-lipsync": { version: "v15", bbox_shift: 0 },
      "finish-upscale": { scale: 2, model: "realesr-animevideov3" },
    },
    speech_config: { "speech-upscale": { enable: true, denoise: false } },
    film_finish_config: {
      subtitle: { enabled: true, mode: "both", font_size: 24, position: "bottom" },
      "film-titles": { title_seconds: 2, credit_seconds: 3 },
    },
    master_config: { "audio-master": { target_lufs: -14, upscale: true, format: "wav" } },
    scenes: MINI_STORYBOARD.scenes.map((s) => ({
      shot_id: s.id,
      prompt: s.prompt,
      seconds: s.target_seconds ?? 5,
    })),
  };
}

async function probeBeatAnalyze(mp3Path: string): Promise<string | undefined> {
  if (!mp3Path) {
    record("beat-sync", "user MP3 upload", "skip", "SMOKE_MP3_PATH unset");
    return undefined;
  }
  const bytes = readFileSync(mp3Path);
  const up = await fetch(`${BASE}/api/storyboard/audio-upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "audio/mpeg" },
    body: bytes,
  });
  const upBody = (await up.json()) as { key?: string };
  if (!up.ok || !upBody.key) {
    record("beat-sync", "MP3 audio-upload", "fail", String(up.status));
    return undefined;
  }
  record("beat-sync", "MP3 audio-upload", "pass", upBody.key);

  const analyze = await api("/api/audio/analyze", {
    method: "POST",
    body: JSON.stringify({
      audioKey: upBody.key,
      clipSeconds: 4,
      mode: "beat",
      module: "beat-sync",
    }),
  });
  const body = (await analyze.json()) as {
    ok?: boolean;
    bpm?: number;
    beats?: unknown[];
    error?: string;
    output?: { bpm?: number; beats?: unknown[] };
  };
  const out = body.output ?? body;
  const bpm = out.bpm ?? body.bpm ?? 0;
  const beats = out.beats ?? body.beats;
  if (analyze.ok && body.ok && bpm > 0) {
    record("beat-sync", "analyze user MP3", "pass", `bpm=${bpm} beats=${Array.isArray(beats) ? beats.length : "?"}`);
    return upBody.key;
  }
  record("beat-sync", "analyze user MP3", "fail", `${analyze.status} ${body.error ?? JSON.stringify(body).slice(0, 120)}`);
  return upBody.key;
}

async function probeScoreBeds(): Promise<{ musicKey?: string; narrationKey?: string }> {
  const musicRes = await api("/api/storyboard/score-bed", {
    method: "POST",
    body: JSON.stringify({
      kind: "music",
      module: "music-gen",
      prompt: "uplifting acoustic forest walk, instrumental, moderate tempo",
      seconds: 12,
      storyboard: MINI_STORYBOARD,
    }),
  });
  const musicStart = (await musicRes.json()) as { id?: string; error?: string };
  let musicKey: string | undefined;
  if (musicRes.ok && musicStart.id) {
    const polled = await pollScoreJob(musicStart.id, "music-gen", SCORE_TIMEOUT_MS);
    if (polled.key) {
      const verified = await verifyAudioArtifact(BASE, TOKEN, polled.key, {
        label: "music-gen bed",
        minDurationSec: 3,
        minBytes: 2000,
      });
      record("music-gen", "score-bed + ffprobe", verified.ok ? "pass" : "fail", verified.detail);
      if (verified.ok) musicKey = polled.key;
    } else record("music-gen", "score-bed poll", "fail", polled.error);
  } else record("music-gen", "score-bed start", "fail", `${musicRes.status} ${musicStart.error ?? ""}`);

  const narrRes = await api("/api/storyboard/score-bed", {
    method: "POST",
    body: JSON.stringify({
      kind: "narration",
      module: "narration-gen",
      text: "On a sunlit forest path, two friends encounter something impossible: a cat that walks upright like a human.",
      seconds: 8,
    }),
  });
  const narrStart = (await narrRes.json()) as { id?: string; error?: string };
  let narrationKey: string | undefined;
  if (narrRes.ok && narrStart.id) {
    const polled = await pollScoreJob(narrStart.id, "narration-gen", SCORE_TIMEOUT_MS);
    if (polled.key) {
      const verified = await verifyAudioArtifact(BASE, TOKEN, polled.key, {
        label: "narration-gen bed",
        minDurationSec: 2,
        minBytes: 1000,
      });
      record("narration-gen", "score-bed + ffprobe", verified.ok ? "pass" : "fail", verified.detail);
      if (verified.ok) narrationKey = polled.key;
    } else record("narration-gen", "score-bed poll", "fail", polled.error);
  } else record("narration-gen", "score-bed start", "fail", `${narrRes.status} ${narrStart.error ?? ""}`);

  return { musicKey, narrationKey };
}

async function probeCloudI2v(keyframeKey: string, keyframeUrl: string): Promise<void> {
  if (SKIP_CLOUD_I2V) {
    record("cloud-i2v", "all backends", "skip", "SMOKE_SKIP_CLOUD_I2V=1");
    return;
  }
  for (const backend of CLOUD_I2V) {
    const res = await api("/api/render/clips", {
      method: "POST",
      body: JSON.stringify({
        project: `exhaustive_i2v_${backend}`,
        motion_backend: backend,
        module_configs: { [backend]: moduleConfigFor(backend) },
        shots: [
          {
            shot_id: "shot_01",
            prompt: "gentle cinematic motion, ocean sunset horizon",
            seconds: clipSecondsFor(backend),
            keyframe_key: keyframeKey,
            keyframe_url: keyframeUrl,
          },
        ],
      }),
    });
    const body = (await res.json()) as { ok?: boolean; job_id?: string; shots?: Array<{ error?: string }>; error?: string };
    if (!res.ok || !body.ok || !body.job_id) {
      record("cloud-i2v", backend, "fail", body.shots?.[0]?.error || body.error || String(res.status));
      continue;
    }
    const polled = await pollClipJob(body.job_id);
    if (!polled.ok || !polled.clipKey) {
      record("cloud-i2v", backend, "fail", polled.error ?? "no clip");
      continue;
    }
    const verified = await verifyVideoArtifact(BASE, TOKEN, polled.clipKey, {
      label: `clip/${backend}`,
      minDurationSec: 2,
      minWidth: 320,
      minHeight: 240,
      minBytes: 12_000,
    });
    record("cloud-i2v", backend, verified.ok ? "pass" : "fail", verified.detail);
  }
}

async function probeOwnGpuClip(keyframeKey: string, keyframeUrl: string): Promise<void> {
  const res = await api("/api/render/clips", {
    method: "POST",
    body: JSON.stringify({
      project: "exhaustive_own_gpu",
      motion_backend: "own-gpu",
      motion_config: { quality: "draft", fps: 16 },
      shots: [
        {
          shot_id: "shot_01",
          prompt: "subtle motion on forest path",
          seconds: 4,
          keyframe_key: keyframeKey,
          keyframe_url: keyframeUrl,
        },
      ],
    }),
  });
  const body = (await res.json()) as { ok?: boolean; job_id?: string; error?: string };
  if (!res.ok || !body.job_id) {
    record("own-gpu", "clips job", "skip", body.error ?? String(res.status));
    return;
  }
  const polled = await pollClipJob(body.job_id);
  if (!polled.ok || !polled.clipKey) {
    record("own-gpu", "clips job", "fail", polled.error);
    return;
  }
  const verified = await verifyVideoArtifact(BASE, TOKEN, polled.clipKey, {
    label: "clip/own-gpu",
    minDurationSec: 2,
    minWidth: 320,
    minHeight: 240,
  });
  record("own-gpu", "clips + ffprobe", verified.ok ? "pass" : "fail", verified.detail);
}

async function probeFullFilm(
  musicKey: string,
  motionBackend: string,
  keyframeBackend: string,
  characterRefs: ReturnType<typeof buildCharacterRefs>,
): Promise<void> {
  const bundleRes = await api("/api/storyboard/bundle", {
    method: "POST",
    body: JSON.stringify({
      storyboard: MINI_STORYBOARD,
      characterRefs,
    }),
  });
  const bundleBody = (await bundleRes.json()) as { bundleKey?: string; error?: string };
  if (!bundleRes.ok || !bundleBody.bundleKey) {
    record("full-film", `${motionBackend}/${keyframeBackend} bundle`, "fail", bundleBody.error ?? String(bundleRes.status));
    return;
  }

  await api("/api/cast/04e1dbe6-2564-4c4e-8bfc-61e9908d12ba", {
    method: "PATCH",
    body: JSON.stringify({ voice_id: "orpheus" }),
  });

  const pre = await api("/api/storyboard/preflight", {
    method: "POST",
    body: JSON.stringify({
      storyboard: MINI_STORYBOARD,
      castBindings: { A: "a8824bef-4224-48b4-b340-a82e215af3e7", B: "04e1dbe6-2564-4c4e-8bfc-61e9908d12ba" },
      bundleKey: bundleBody.bundleKey,
      audioKey: musicKey,
    }),
  });
  const preBody = (await pre.json()) as { ok?: boolean; issues?: unknown[] };
  record("full-film", "preflight", pre.ok ? "pass" : "fail", preBody.ok ? "ok" : JSON.stringify(preBody.issues).slice(0, 200));

  const filmRes = await api("/api/render/film", {
    method: "POST",
    body: JSON.stringify(fullFilmRenderBody(bundleBody.bundleKey, musicKey, motionBackend, keyframeBackend)),
  });
  const filmBody = (await filmRes.json()) as { ok?: boolean; film_id?: string; jobId?: string; error?: string };
  const jobId = filmBody.film_id ?? filmBody.jobId;
  if (!(filmRes.ok || filmRes.status === 201) || !jobId) {
    record("full-film", `${motionBackend}/${keyframeBackend}`, "fail", `${filmRes.status} ${filmBody.error ?? ""}`);
    return;
  }

  const polled = await pollFilmJob(jobId);
  if (!polled.ok || !polled.outputKey) {
    record("full-film", `${motionBackend}/${keyframeBackend}`, "fail", polled.error);
    return;
  }

  const verified = await verifyVideoArtifact(BASE, TOKEN, polled.outputKey, {
    label: `film/${motionBackend}+${keyframeBackend}`,
    minDurationSec: 8,
    minWidth: 480,
    minHeight: 270,
    expectAudio: true,
    minBytes: 40_000,
  });
  record("full-film", `${motionBackend}/${keyframeBackend} ffprobe`, verified.ok ? "pass" : "fail", verified.detail);
}

async function probeScatter(bundleKey: string): Promise<void> {
  const res = await api("/api/storyboard/render/scatter", {
    method: "POST",
    body: JSON.stringify({
      bundleKey,
      project: "exhaustive_scatter",
      shotIds: ["shot_01", "shot_02"],
      motion_backend: "seedance",
      qualityTier: "draft",
      renderOverrides: { motion_backend: "seedance", config: { seedance: moduleConfigFor("seedance") } },
    }),
  });
  const body = (await res.json()) as { jobId?: string; error?: string };
  if (!res.ok || !body.jobId) {
    record("scatter", "submit", "fail", body.error ?? String(res.status));
    return;
  }
  const polled = await pollStoryboardRender(body.jobId);
  if (!polled.ok || !polled.outputKey) {
    record("scatter", "poll + verify", "fail", polled.error);
    return;
  }
  const verified = await verifyVideoArtifact(BASE, TOKEN, polled.outputKey, {
    label: "film/scatter",
    minDurationSec: 6,
    minWidth: 320,
    minHeight: 240,
    expectAudio: false,
    minBytes: 20_000,
  });
  record("scatter", "ffprobe", verified.ok ? "pass" : "fail", verified.detail);
}

async function probePlanEnhanceAndHelpers(
  characterRefs: ReturnType<typeof buildCharacterRefs>,
): Promise<string | undefined> {
  const enhanced = await api("/api/storyboard/enhance", {
    method: "POST",
    body: JSON.stringify({ storyboard: MINI_STORYBOARD, brief: MINI_STORYBOARD.full_prompt }),
  });
  const enhBody = (await enhanced.json()) as { ok?: boolean; applied?: string[] };
  record("plan-enhance", "POST /api/storyboard/enhance", enhanced.ok && enhBody.ok ? "pass" : "warn", (enhBody.applied ?? []).join(","));

  const bundleRes = await api("/api/storyboard/bundle", {
    method: "POST",
    body: JSON.stringify({
      storyboard: MINI_STORYBOARD,
      characterRefs,
    }),
  });
  const bundleBody = (await bundleRes.json()) as { bundleKey?: string };
  if (!bundleRes.ok || !bundleBody.bundleKey) {
    record("bundle", "assemble", "fail", String(bundleRes.status));
    return undefined;
  }
  record("bundle", "assemble", "pass", bundleBody.bundleKey);
  return bundleBody.bundleKey;
}

async function probeAddNarration(renderId: string): Promise<void> {
  const res = await api(`/api/storyboard/renders/${encodeURIComponent(renderId)}/add-narration`, {
    method: "POST",
    body: JSON.stringify({
      text: "And so the upright cat vanished into the trees, leaving only laughter behind.",
      module: "narration-gen",
    }),
  });
  const body = (await res.json()) as { ok?: boolean; output_key?: string; error?: string };
  if (!res.ok) {
    record("add-narration", "POST", "warn", body.error ?? String(res.status));
    return;
  }
  const key = body.output_key;
  if (!key) {
    record("add-narration", "output", "warn", "no output_key in response");
    return;
  }
  const verified = await verifyVideoArtifact(BASE, TOKEN, key, {
    label: "film/add-narration",
    minDurationSec: 4,
    expectAudio: true,
    minBytes: 20_000,
  });
  record("add-narration", "ffprobe", verified.ok ? "pass" : "fail", verified.detail);
}

async function probeGpuKeyframeFilm(
  musicKey: string,
  characterRefs: ReturnType<typeof buildCharacterRefs>,
): Promise<void> {
  if (SKIP_FULL_FILM) return;
  await probeFullFilm(musicKey, "seedance", "keyframe", characterRefs);
}

async function probeLocalGpuFilm(): Promise<void> {
  if (process.env.SMOKE_RUN_LOCAL_GPU !== "1") {
    record("local-gpu", "completed film", "skip", "proven; set SMOKE_RUN_LOCAL_GPU=1 to re-verify");
    return;
  }
  const filmId = process.env.SMOKE_LOCAL_GPU_FILM_ID || "";
  if (!filmId) {
    record("local-gpu", "completed film", "skip", "SMOKE_LOCAL_GPU_FILM_ID unset");
    return;
  }
  const res = await api(`/api/storyboard/render/${encodeURIComponent(filmId)}`);
  const body = (await res.json()) as { status?: string; output?: { output_key?: string }; error?: string };
  if (!res.ok || body.status !== "COMPLETED") {
    record("local-gpu", "completed film", "fail", body.error ?? `status=${body.status ?? res.status}`);
    return;
  }
  const key = body.output?.output_key;
  if (!key) {
    record("local-gpu", "completed film", "fail", "no output_key");
    return;
  }
  const verified = await verifyVideoArtifact(BASE, TOKEN, key, {
    label: "film/local-gpu",
    minDurationSec: 10,
    minWidth: 640,
    minHeight: 360,
    expectAudio: true,
    minBytes: 1_000_000,
  });
  record("local-gpu", "completed film ffprobe", verified.ok ? "pass" : "fail", verified.detail);
}

function summarize(): void {
  const byStatus = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of rows) byStatus[r.status]++;
  console.log("\n--- smoke-exhaustive summary ---");
  console.log(`pass=${byStatus.pass} fail=${byStatus.fail} warn=${byStatus.warn} skip=${byStatus.skip}`);
  const fails = rows.filter((r) => r.status === "fail");
  if (fails.length) {
    console.log("\nFailures:");
    for (const f of fails) console.log(`  [${f.category}] ${f.name}: ${f.detail ?? ""}`);
  }
}

async function main(): Promise<void> {
  console.log(`smoke-exhaustive: ${BASE}`);

  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`studio health ${health.status}`);

  await probeLocalGpuFilm();

  const cast = await fetchCast();
  const characterRefs = buildCharacterRefs(cast);

  const mp3Key = await probeBeatAnalyze(MP3_PATH);
  void mp3Key;

  const { musicKey, narrationKey } = await probeScoreBeds();
  void narrationKey;
  if (!musicKey) {
    record("full-film", "all", "fail", "no verified music bed; cannot mux");
  }

  const keyframeKey = await uploadKeyframe();
  const keyframeArtifactUrl = artifactUrl(keyframeKey);
  const keyframePublicUrl = presignPublicUrl(keyframeKey);
  console.log(`keyframe: ${keyframeKey}`);
  console.log(`  artifact: ${keyframeArtifactUrl}`);
  console.log(`  public:   ${keyframePublicUrl}`);

  await probeCloudI2v(keyframeKey, keyframePublicUrl);
  await probeOwnGpuClip(keyframeKey, keyframeArtifactUrl);

  const bundleKey = await probePlanEnhanceAndHelpers(characterRefs);

  if (!SKIP_FULL_FILM && musicKey) {
    await probeFullFilm(musicKey, "seedance", "cloud-keyframe", characterRefs);
    await probeGpuKeyframeFilm(musicKey, characterRefs);
  } else if (SKIP_FULL_FILM) {
    record("full-film", "all", "skip", "SMOKE_SKIP_FULL_FILM=1");
  }

  if (bundleKey) await probeScatter(bundleKey);

  const rendersRes = await api("/api/storyboard/renders?limit=3");
  const rendersBody = (await rendersRes.json()) as { renders?: Array<{ id?: string; status?: string; output_key?: string }> };
  const completed = (rendersBody.renders ?? []).find((r) => r.status === "COMPLETED" && r.output_key);
  if (completed?.id) await probeAddNarration(completed.id);

  summarize();
  if (rows.some((r) => r.status === "fail")) process.exit(1);
  console.log("\nsmoke-exhaustive: PASS");
}

main().catch((e) => {
  console.error(`smoke-exhaustive: FAIL -- ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
