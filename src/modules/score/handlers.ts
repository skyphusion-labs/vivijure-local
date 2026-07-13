import type {
  InvokeRequest,
  InvokeResponse,
  PollRequest,
  PollResponse,
  ScoreInput,
  ScoreOutput,
} from "@skyphusion-labs/vivijure-core";
import { aiGatewayConfigured } from "../../platform/ai-gateway.js";
import { aiRun } from "../../platform/ai-run.js";
import type { RunpodModuleEnv } from "../runpod/env.js";
import {
  authHeader,
  classifyGoneState,
  runpodBase,
  runpodJobGone,
  terminalErrorInOutput,
} from "../runpod/shared.js";
import { putAudioBytes } from "../runpod/storage.js";
import {
  MODEL,
  appliedTags,
  audioKey,
  buildMusicParams,
  decodePoll,
  encodePoll,
  mimeForFormat,
  normalizeConfig,
  parseAudioUrl,
  promptFromScoreInput,
  readOutput,
  type MusicGenerateConfig,
} from "./music-gen-core.js";
import { readMusicState, writeMusicState } from "./music-gen-state.js";

const NARRATION_ENDPOINT = "minimax-speech-02-hd";

export interface ScoreModuleEnv extends RunpodModuleEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
}

export function scoreModuleEnvFromProcess(env: NodeJS.ProcessEnv): ScoreModuleEnv {
  return {
    RUNPOD_API_KEY: env.RUNPOD_API_KEY?.trim() || undefined,
    RUNPOD_ENDPOINT_ID: env.RUNPOD_ENDPOINT_ID?.trim() || undefined,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined,
    GATEWAY_ID: env.GATEWAY_ID?.trim() || "vivijure",
    CF_AIG_TOKEN: env.CF_AIG_TOKEN?.trim() || undefined,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_REGION: env.S3_REGION,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
  };
}

export function scoreModuleEnvFromRuntime(runtime: { asProcessEnv(): NodeJS.ProcessEnv }): ScoreModuleEnv {
  return scoreModuleEnvFromProcess(runtime.asProcessEnv());
}

function narrationText(input: ScoreInput, config: Record<string, unknown>): string {
  const configured = typeof config.text === "string" ? config.text.trim() : "";
  if (configured) return configured.slice(0, 10_000);
  const sb = input.storyboard as { scenes?: Array<{ narration?: string; prompt?: string }>; title?: string } | undefined;
  if (sb?.scenes?.length) {
    const lines = sb.scenes
      .map((s) => (s.narration?.trim() || s.prompt?.trim() || ""))
      .filter(Boolean);
    if (lines.length) return lines.join("\n\n").slice(0, 10_000);
  }
  if (sb?.title) return `A cinematic narration for "${sb.title}".`.slice(0, 10_000);
  throw new Error("text required (set config.text or provide storyboard scenes)");
}

interface NarrationPollState {
  jobId: string;
  job_id: string;
  film_key: string;
  format: string;
  submittedAt?: number;
}

function encodeNarrationPoll(s: NarrationPollState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

function decodeNarrationPoll(token: string): NarrationPollState | null {
  try {
    const o = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as NarrationPollState;
    if (o && typeof o.jobId === "string" && typeof o.film_key === "string") return o;
  } catch {
    /* bad token */
  }
  return null;
}

const musicGenInflight = new Set<string>();

async function runMusicGeneration(
  env: ScoreModuleEnv,
  jobId: string,
  input: ScoreInput,
  config: MusicGenerateConfig,
): Promise<void> {
  const format = config.format ?? "mp3";
  const applied = appliedTags(format, config);
  try {
    const prompt = promptFromScoreInput(input, config);
    const params = buildMusicParams(prompt, config);
    const result = await aiRun(env, MODEL, params);
    const url = parseAudioUrl(result);
    if (!url) throw new Error("model completed but returned no audio URL");
    const aresp = await fetch(url);
    if (!aresp.ok) throw new Error(`audio fetch ${aresp.status}`);
    const mime = aresp.headers.get("content-type")?.split(";")[0]?.trim() || mimeForFormat(format);
    const bytes = new Uint8Array(await aresp.arrayBuffer());
    const key = audioKey(jobId, format);
    await putAudioBytes(env, key, bytes, mime);
    await writeMusicState(env, jobId, {
      status: "done",
      film_key: input.film_key,
      audio_key: key,
      mime,
      applied: [...applied, `audio:${key}`],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeMusicState(env, jobId, {
      status: "failed",
      error: msg.slice(0, 500),
      applied,
    });
  } finally {
    musicGenInflight.delete(jobId);
  }
}

function startMusicGeneration(
  env: ScoreModuleEnv,
  jobId: string,
  input: ScoreInput,
  config: MusicGenerateConfig,
): void {
  if (musicGenInflight.has(jobId)) return;
  musicGenInflight.add(jobId);
  void runMusicGeneration(env, jobId, input, config);
}

export async function invokeMusicGen(
  env: ScoreModuleEnv,
  req: InvokeRequest<ScoreInput>,
): Promise<InvokeResponse<ScoreOutput>> {
  const filmKey = typeof req.input?.film_key === "string" ? req.input.film_key.trim() : "";
  if (!filmKey) return { ok: false, error: "score: input.film_key required" };
  if (!aiGatewayConfigured(env)) {
    return { ok: true, output: { film_key: filmKey, applied: ["music-gen:skipped-no-gateway"] } };
  }

  const config = normalizeConfig(req.config ?? {});
  const scoredInput = { ...req.input, film_key: filmKey };
  try {
    buildMusicParams(promptFromScoreInput(scoredInput, config), config);
  } catch (e) {
    return { ok: false, error: "score: " + (e as Error).message };
  }

  const jobId =
    typeof req.context?.job_id === "string" && req.context.job_id.trim()
      ? req.context.job_id.trim()
      : crypto.randomUUID();
  const applied = appliedTags(config.format ?? "mp3", config);

  try {
    await writeMusicState(env, jobId, {
      status: "running",
      started_at: Math.floor(Date.now() / 1000),
      film_key: filmKey,
      applied,
    });
  } catch (e) {
    return { ok: false, error: "score: could not persist run state: " + (e as Error).message };
  }

  startMusicGeneration(env, jobId, scoredInput, config);
  return { ok: true, pending: true, poll: encodePoll({ job_id: jobId }) };
}

export async function pollMusicGen(
  env: ScoreModuleEnv,
  body: PollRequest,
): Promise<PollResponse<ScoreOutput>> {
  const token = decodePoll(body.poll);
  if (!token) return { ok: false, error: "score: bad poll token" };
  const state = await readMusicState(env, token.job_id);
  if (!state) return { ok: false, error: "score: run state not found (expired or bad token)" };
  if (state.status === "done") return { ok: true, output: readOutput(state) };
  if (state.status === "failed") return { ok: false, error: state.error || "generation failed" };
  return { ok: true, pending: true };
}

export async function invokeNarrationGen(
  env: ScoreModuleEnv,
  req: InvokeRequest<ScoreInput>,
): Promise<InvokeResponse<ScoreOutput>> {
  const filmKey = typeof req.input?.film_key === "string" ? req.input.film_key.trim() : "";
  const jobId = typeof req.context?.job_id === "string" ? req.context.job_id.trim() : "";
  if (!filmKey || !jobId) return { ok: false, error: "score: context.job_id and input.film_key required" };
  const apiKey = env.RUNPOD_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "narration-gen: RUNPOD_API_KEY not configured" };

  let text: string;
  try {
    text = narrationText(req.input, req.config ?? {});
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const format = req.config?.format === "wav" ? "wav" : req.config?.format === "flac" ? "flac" : "mp3";
  const base = runpodBase(NARRATION_ENDPOINT);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(apiKey), "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          prompt: text,
          voice_id: typeof req.config?.voice_id === "string" ? req.config.voice_id : "Wise_Woman",
          format,
          sample_rate: 44100,
        },
      }),
    });
    if (!r.ok) return { ok: false, error: `narration-gen /run -> ${r.status}` };
    const runpodJobId = ((await r.json()) as { id?: string }).id;
    if (!runpodJobId) return { ok: false, error: "narration-gen /run returned no job id" };
    return {
      ok: true,
      pending: true,
      poll: encodeNarrationPoll({
        jobId: runpodJobId,
        job_id: jobId,
        film_key: filmKey,
        format,
        submittedAt: Date.now(),
      }),
    };
  } catch (e) {
    return { ok: false, error: `narration-gen submit failed: ${(e as Error).message}` };
  }
}

export async function pollNarrationGen(
  env: ScoreModuleEnv,
  body: PollRequest,
): Promise<PollResponse<ScoreOutput>> {
  const st = decodeNarrationPoll(body.poll);
  if (!st) return { ok: false, error: "narration-gen: bad poll token" };
  const apiKey = env.RUNPOD_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "narration-gen: RUNPOD_API_KEY not configured" };
  const base = runpodBase(NARRATION_ENDPOINT);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(apiKey) });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return { ok: false, error: "narration-gen job not found" };
    }
    return { ok: true, pending: true };
  }
  const term = terminalErrorInOutput(s.output) ?? (typeof s.error === "string" ? s.error : null);
  if (term) return { ok: false, error: term };
  if (s.status !== "COMPLETED") return { ok: true, pending: true };

  const out = (s.output ?? {}) as Record<string, unknown>;
  const audioUrl =
    typeof out.result === "string" ? out.result : typeof out.audio === "string" ? out.audio : null;
  if (!audioUrl) return { ok: false, error: "narration-gen completed but returned no audio URL" };

  const key = `out/narr-${st.job_id}.${st.format === "wav" ? "wav" : st.format === "flac" ? "flac" : "mp3"}`;
  try {
    const aud = await fetch(audioUrl);
    if (!aud.ok) return { ok: false, error: `narration-gen audio download -> ${aud.status}` };
    const mime = st.format === "wav" ? "audio/wav" : st.format === "flac" ? "audio/flac" : "audio/mpeg";
    await putAudioBytes(env, key, new Uint8Array(await aud.arrayBuffer()), mime);
  } catch (e) {
    return { ok: false, error: `narration-gen store failed: ${(e as Error).message}` };
  }
  return {
    ok: true,
    output: {
      film_key: st.film_key,
      applied: [`narration:minimax-speech`, `audio:${key}`],
    },
  };
}

export type ScoreModuleName = "music-gen" | "narration-gen";

export function isScoreModuleName(name: string): name is ScoreModuleName {
  return name === "music-gen" || name === "narration-gen";
}

export async function invokeScoreModule(
  env: ScoreModuleEnv,
  moduleName: ScoreModuleName,
  req: InvokeRequest<ScoreInput>,
): Promise<InvokeResponse<ScoreOutput>> {
  if (req.hook !== "score") return { ok: false, error: "unsupported hook " + String(req.hook) };
  if (moduleName === "music-gen") return invokeMusicGen(env, req);
  return invokeNarrationGen(env, req);
}

export async function pollScoreModule(
  env: ScoreModuleEnv,
  moduleName: ScoreModuleName,
  body: PollRequest,
): Promise<PollResponse<ScoreOutput>> {
  if (moduleName === "music-gen") return pollMusicGen(env, body);
  return pollNarrationGen(env, body);
}
