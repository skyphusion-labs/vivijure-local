// CPU module invoke/poll handlers (ported from vivijure module workers).

import type {
  BeatSyncOutput,
  FilmFinishInput,
  FilmFinishOutput,
  InvokeRequest,
  InvokeResponse,
  MasterInput,
  MasterOutput,
  PollRequest,
  PollResponse,
  ScoreInput,
} from "../types.js";
import {
  appliedTags,
  buildAnalyzeBody,
  normalizeConfig,
  parseContainerResponse,
} from "./beat-sync-core.js";
import {
  buildMasterBody,
  coerceConfig,
  masterOutputFromResult,
  parseContainerResult,
  passthroughOutput as masterPassthrough,
} from "./audio-master-core.js";
import {
  buildContainerSpec as buildTitlesSpec,
  coerceConfig as coerceTitlesConfig,
  completedOutput as titlesCompletedOutput,
  CONTAINER_NOTFOUND_GRACE_MS as TITLES_GRACE_MS,
  decodePoll as decodeTitlesPoll,
  encodePoll as encodeTitlesPoll,
  hasCards,
  hasTitleCard,
  passthroughOutput as titlesPassthrough,
} from "./film-titles-core.js";
import {
  buildContainerSpec as buildSubtitleSpec,
  buildSrt,
  coerceConfig as coerceSubtitleConfig,
  completedOutput as subtitleCompletedOutput,
  CONTAINER_NOTFOUND_GRACE_MS as SUBTITLE_GRACE_MS,
  decodePoll as decodeSubtitlePoll,
  encodePoll as encodeSubtitlePoll,
  hasCaptions,
  passthroughOutput as subtitlePassthrough,
} from "./subtitle-core.js";
import type { CpuModuleEnv } from "./vpc-env.js";

export async function invokeBeatSync(
  env: CpuModuleEnv,
  req: InvokeRequest<ScoreInput>,
): Promise<InvokeResponse<BeatSyncOutput>> {
  const filmKey = typeof req.input?.film_key === "string" ? req.input.film_key.trim() : "";
  if (!filmKey) return { ok: false, error: "score: input.film_key required" };

  const audioUrl = typeof req.config?.audio_url === "string" ? req.config.audio_url.trim() : "";
  if (!audioUrl) {
    return { ok: true, output: { film_key: filmKey, applied: ["beat-sync:skipped"] } };
  }

  const audioKey = typeof req.config?.audio_key === "string" ? req.config.audio_key.trim() : "";
  const config = normalizeConfig(req.config);
  const body = buildAnalyzeBody(config, audioUrl, audioKey);

  if (!env.AUDIO_BEAT_SYNC_VPC) {
    return { ok: false, error: "score: AUDIO_BEAT_SYNC_VPC not configured" };
  }

  let resp: Response;
  try {
    resp = await env.AUDIO_BEAT_SYNC_VPC.fetch("http://audio-beat-sync/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "score: beat-sync VPC fetch failed: " + msg.slice(0, 200) };
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    return { ok: false, error: "score: beat-sync container returned non-JSON" };
  }

  const parsed = parseContainerResponse(raw);
  if (!parsed.ok) return { ok: false, error: "score: " + parsed.error };

  return {
    ok: true,
    output: {
      film_key: filmKey,
      applied: appliedTags(config.mode),
      beat_plan: parsed.plan,
    },
  };
}

function masterPassthroughInvoke(
  input: MasterInput,
  reason: string,
  opts: { detail?: string } = {},
): InvokeResponse<MasterOutput> {
  const output = masterPassthrough(input, reason, opts);
  console.warn(`audio-master: passthrough (${output.degraded}) film=${input.film_id}`);
  return { ok: true, output };
}

export async function invokeAudioMaster(
  env: CpuModuleEnv,
  req: InvokeRequest<MasterInput>,
): Promise<InvokeResponse<MasterOutput>> {
  const input = req.input;
  if (!input?.film_id || !input?.audio_key || !input?.audio_url || !input?.output_url || !input?.output_key) {
    return { ok: false, error: "audio-master: input needs film_id, audio_key, audio_url, output_url, output_key" };
  }
  if (!env.AUDIO_MASTER_VPC) return masterPassthroughInvoke(input, "no-vpc-binding");

  const cfg = coerceConfig(req.config);

  let resp: Response;
  try {
    resp = await env.AUDIO_MASTER_VPC.fetch("http://audio-master/master", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildMasterBody(input, cfg)),
    });
  } catch (e) {
    return masterPassthroughInvoke(input, "container-unreachable", { detail: (e as Error).message });
  }
  if (!resp.ok) return masterPassthroughInvoke(input, "container-failed", { detail: "HTTP " + resp.status });

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return masterPassthroughInvoke(input, "container-bad-response");
  }
  const res = parseContainerResult(body);
  if (!res || !res.ok) return masterPassthroughInvoke(input, "container-failed");
  if (!res.key) return masterPassthroughInvoke(input, "no-output-key", { detail: "container returned no mastered key" });

  return { ok: true, output: masterOutputFromResult(input, res) };
}

const TITLES_ROUTE = "film-titles";

function titlesPassthroughInvoke(
  input: FilmFinishInput,
  reason: string,
  degraded = false,
): InvokeResponse<FilmFinishOutput> {
  const output = titlesPassthrough(input, reason, { degraded });
  if (degraded) console.warn(`film-titles: passthrough (${reason}) film=${input.film_key}`);
  return { ok: true, output };
}

async function submitTitlesAsync(env: CpuModuleEnv, spec: Record<string, unknown>): Promise<string | null> {
  if (!env.VIDEO_FINISH_VPC) return null;
  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch(`http://video-finish/async/${TITLES_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
  } catch {
    return null;
  }
  if (resp.status !== 202) return null;
  try {
    const body = (await resp.json()) as { ok?: boolean; jobId?: string };
    return body.ok === true && typeof body.jobId === "string" && body.jobId.length > 0 ? body.jobId : null;
  } catch {
    return null;
  }
}

async function invokeFilmTitlesSync(
  env: CpuModuleEnv,
  input: FilmFinishInput,
  spec: Record<string, unknown>,
  titleSeconds: number,
): Promise<InvokeResponse<FilmFinishOutput>> {
  if (!env.VIDEO_FINISH_VPC) return titlesPassthroughInvoke(input, "passthrough:no-vpc-binding", true);
  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch("http://video-finish/film-titles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
  } catch {
    return titlesPassthroughInvoke(input, "passthrough:container-unreachable", true);
  }
  if (!resp.ok) return titlesPassthroughInvoke(input, "passthrough:container-failed", true);
  let body: { ok?: boolean; key?: string };
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    return titlesPassthroughInvoke(input, "passthrough:container-bad-response", true);
  }
  if (!body.ok) return titlesPassthroughInvoke(input, "passthrough:container-failed", true);
  return {
    ok: true,
    output: {
      film_key: body.key || input.output_key,
      applied: ["film-titles"],
      ...(titleSeconds > 0 ? { prepend_seconds: titleSeconds } : {}),
    },
  };
}

export async function invokeFilmTitles(
  env: CpuModuleEnv,
  req: InvokeRequest<FilmFinishInput>,
): Promise<InvokeResponse<FilmFinishOutput>> {
  const input = req.input;
  if (!input?.film_key || !input.video_url || !input.output_url || !input.output_key) {
    return { ok: false, error: "film.finish: input needs film_key, video_url, output_url, output_key" };
  }
  if (!hasCards(input)) return titlesPassthroughInvoke(input, "noop:no-cards");
  if (!env.VIDEO_FINISH_VPC) return titlesPassthroughInvoke(input, "passthrough:no-vpc-binding", true);

  const cfg = coerceTitlesConfig(req.config);
  const spec = buildTitlesSpec(input, cfg);
  const titleSeconds = hasTitleCard(input) ? cfg.title_seconds : 0;
  const jobId = await submitTitlesAsync(env, spec);
  if (jobId) {
    return {
      ok: true,
      pending: true,
      poll: encodeTitlesPoll({
        jobId,
        filmKey: input.film_key,
        outputKey: input.output_key,
        submittedAt: Date.now(),
        titleSeconds,
      }),
    };
  }
  return invokeFilmTitlesSync(env, input, spec, titleSeconds);
}

export async function pollFilmTitles(
  env: CpuModuleEnv,
  body: PollRequest,
): Promise<PollResponse<FilmFinishOutput>> {
  const st = decodeTitlesPoll(body.poll);
  if (!st) return { ok: false, error: "film-titles: bad poll token" };
  if (!env.VIDEO_FINISH_VPC) return { ok: false, error: "film-titles: no VIDEO_FINISH_VPC binding" };

  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch(
      `http://video-finish/async/status/${encodeURIComponent(st.jobId)}`,
    );
  } catch {
    return { ok: true, pending: true };
  }
  if (resp.status === 404) {
    return Date.now() - st.submittedAt < TITLES_GRACE_MS
      ? { ok: true, pending: true }
      : { ok: false, error: "film-titles: video-finish container job not found (restarted); resubmit" };
  }
  if (!resp.ok) return { ok: true, pending: true };
  let s: { status?: string; result?: { ok?: boolean; key?: string } | null; error?: string };
  try {
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (s.status === "completed") {
    if (!s.result || s.result.ok !== true) {
      return { ok: false, error: "film-titles: container completed without an ok result" };
    }
    return { ok: true, output: titlesCompletedOutput(s.result, st) };
  }
  if (s.status === "failed") {
    return { ok: false, error: "film-titles: container job failed: " + (s.error ?? "unknown") };
  }
  return { ok: true, pending: true };
}

const SUBTITLE_ROUTE = "subtitle";

function subtitlePassthroughInvoke(
  input: FilmFinishInput,
  reason: string,
  degraded = false,
): InvokeResponse<FilmFinishOutput> {
  const output = subtitlePassthrough(input, reason, { degraded });
  if (degraded) console.warn(`subtitle: passthrough (${reason}) film=${input.film_key}`);
  return { ok: true, output };
}

async function submitSubtitleAsync(env: CpuModuleEnv, spec: Record<string, unknown>): Promise<string | null> {
  if (!env.VIDEO_FINISH_VPC) return null;
  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch(`http://video-finish/async/${SUBTITLE_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
  } catch {
    return null;
  }
  if (resp.status !== 202) return null;
  try {
    const body = (await resp.json()) as { ok?: boolean; jobId?: string };
    return body.ok === true && typeof body.jobId === "string" && body.jobId.length > 0 ? body.jobId : null;
  } catch {
    return null;
  }
}

async function invokeSubtitleSync(
  env: CpuModuleEnv,
  input: FilmFinishInput,
  spec: Record<string, unknown>,
): Promise<InvokeResponse<FilmFinishOutput>> {
  if (!env.VIDEO_FINISH_VPC) return subtitlePassthroughInvoke(input, "passthrough:no-vpc-binding", true);
  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch("http://video-finish/subtitle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
  } catch {
    return subtitlePassthroughInvoke(input, "passthrough:container-unreachable", true);
  }
  if (!resp.ok) return subtitlePassthroughInvoke(input, "passthrough:container-failed", true);
  let body: { ok?: boolean; key?: string; burned?: boolean; sidecar?: boolean };
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    return subtitlePassthroughInvoke(input, "passthrough:container-bad-response", true);
  }
  if (!body.ok) return subtitlePassthroughInvoke(input, "passthrough:container-failed", true);
  const applied: string[] = [];
  if (body.burned) applied.push("subtitle");
  if (body.sidecar) applied.push("subtitle:sidecar");
  if (!applied.length) applied.push("noop:no-dialogue");
  const filmKey = body.burned ? (body.key || input.output_key) : input.film_key;
  return { ok: true, output: { film_key: filmKey, applied } };
}

export async function invokeSubtitle(
  env: CpuModuleEnv,
  req: InvokeRequest<FilmFinishInput>,
): Promise<InvokeResponse<FilmFinishOutput>> {
  const input = req.input;
  if (!input?.film_key || !input.video_url || !input.output_url || !input.output_key) {
    return { ok: false, error: "film.finish: input needs film_key, video_url, output_url, output_key" };
  }

  const cfg = coerceSubtitleConfig(req.config);
  if (!cfg.enabled) return subtitlePassthroughInvoke(input, "noop:disabled");
  if (!hasCaptions(input)) return subtitlePassthroughInvoke(input, "noop:no-dialogue");
  if (!env.VIDEO_FINISH_VPC) return subtitlePassthroughInvoke(input, "passthrough:no-vpc-binding", true);

  const wantSidecar = cfg.mode === "sidecar" || cfg.mode === "both";
  const haveSidecarUrl = wantSidecar && typeof input.sidecar_url === "string" && input.sidecar_url.length > 0;
  if (cfg.mode === "sidecar" && !haveSidecarUrl) {
    return subtitlePassthroughInvoke(input, "passthrough:sidecar-no-url", true);
  }

  const srt = buildSrt(input.captions);
  const spec = buildSubtitleSpec(input, cfg, srt);
  const jobId = await submitSubtitleAsync(env, spec);
  if (jobId) {
    return {
      ok: true,
      pending: true,
      poll: encodeSubtitlePoll({
        jobId,
        filmKey: input.film_key,
        outputKey: input.output_key,
        submittedAt: Date.now(),
      }),
    };
  }
  return invokeSubtitleSync(env, input, spec);
}

export async function pollSubtitle(
  env: CpuModuleEnv,
  body: PollRequest,
): Promise<PollResponse<FilmFinishOutput>> {
  const st = decodeSubtitlePoll(body.poll);
  if (!st) return { ok: false, error: "subtitle: bad poll token" };
  if (!env.VIDEO_FINISH_VPC) return { ok: false, error: "subtitle: no VIDEO_FINISH_VPC binding" };

  let resp: Response;
  try {
    resp = await env.VIDEO_FINISH_VPC.fetch(
      `http://video-finish/async/status/${encodeURIComponent(st.jobId)}`,
    );
  } catch {
    return { ok: true, pending: true };
  }
  if (resp.status === 404) {
    return Date.now() - st.submittedAt < SUBTITLE_GRACE_MS
      ? { ok: true, pending: true }
      : { ok: false, error: "subtitle: video-finish container job not found (restarted); resubmit" };
  }
  if (!resp.ok) return { ok: true, pending: true };
  let s: {
    status?: string;
    result?: { ok?: boolean; key?: string; burned?: boolean; sidecar?: boolean } | null;
    error?: string;
  };
  try {
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (s.status === "completed") {
    if (!s.result || s.result.ok !== true) {
      return { ok: false, error: "subtitle: container completed without an ok result" };
    }
    return { ok: true, output: subtitleCompletedOutput(s.result, st) };
  }
  if (s.status === "failed") {
    return { ok: false, error: "subtitle: container job failed: " + (s.error ?? "unknown") };
  }
  return { ok: true, pending: true };
}

export type CpuModuleName = "beat-sync" | "audio-master" | "film-titles" | "subtitle";

export const CPU_MODULE_NAMES: readonly CpuModuleName[] = [
  "beat-sync",
  "audio-master",
  "film-titles",
  "subtitle",
];

export function isCpuModuleName(name: string): name is CpuModuleName {
  return (CPU_MODULE_NAMES as readonly string[]).includes(name);
}
