import type {
  CastImageInput,
  CastImageOutput,
  DialogueInput,
  DialogueOutput,
  DialogueShotAudio,
  InvokeRequest,
  InvokeResponse,
  NotifyInput,
  NotifyOutput,
  PlanEnhanceInput,
  PlanEnhanceOutput,
  PollRequest,
  PollResponse,
  SpeechInput,
  SpeechOutput,
} from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { untrustedLabel } from "../../log-scrub.js";
import { buildSilentWav } from "../../dev/minimal-media.js";
import { plannerAiMockEnabled } from "../../planner-ai-mock.js";
import { aiRun } from "../../platform/ai-run.js";
import type { ChainModuleEnv } from "./chain-env.js";
import {
  FLAG_FALLBACK_MODEL,
  MODELS,
  buildState as buildCastState,
  decodePoll as decodeCastPoll,
  encodePoll as encodeCastPoll,
  isFlaggedError,
  readOutput as readCastOutput,
  refKey,
  stateKey as castStateKey,
  type CastImageState,
} from "./cast-image-core.js";
import { generateCastImage } from "./cast-image-gen.js";
export { invokeImageGenerate, MODELS as IMAGE_GENERATE_MODELS } from "./image-generate-core.js";
export type { ImageGenerateInput, ImageGenerateOutput } from "./image-generate-core.js";
import {
  AUDIO_MIME,
  MODEL as DIALOGUE_MODEL,
  appliedTags as dialogueAppliedTags,
  audioKey,
  buildTtsParams,
  decodePoll as decodeDialoguePoll,
  dialogueGatewayConfigured,
  encodePoll as encodeDialoguePoll,
  normalizeInput as normalizeDialogueInput,
  readOutput as readDialogueOutput,
  stateKey as dialogueStateKey,
  type RunState as DialogueRunState,
  type NormalizedLine,
} from "./dialogue-gen-core.js";
import { FROM, renderCompleteEmail } from "./notify-email-core.js";
import { mockPlannerRaw } from "../../planner-ai-mock.js";
import {
  buildMessages,
  mergeEnhanced,
  mockEnhanced,
  parseEnhanced,
  parsePlanStoryboard,
  scenePrompts,
  type ChatMessage,
  type Intensity,
} from "./plan-enhance-core.js";
import { augmentSystemForOllama } from "./ollama-prompts.js";
import { ollamaConfigured } from "./ollama.js";
import { direct as directPlanEnhance } from "./plan-enhance-provider.js";
import { coerceConfig as coerceSpeechConfig, processSpeechLocal } from "./speech-upscale-core.js";
import {
  buildRunPodBody,
  decodeSpeechPoll,
  encodeSpeechPoll,
  parseSpeechBackendOutput,
  passthroughOutput as speechPassthrough,
  successRunpodOutput,
} from "./speech-upscale-core.js";
import {
  resolveSpeechBackend,
  speechLocalDoorRaw,
  speechRunpodConfigured,
  speechRunpodEndpointId,
} from "./chain-env.js";
import { normalizeDoorBaseUrls, orderDoors } from "../door-pool.js";
import {
  authHeader,
  cancelRunpodJobBestEffort,
  classifyGoneState,
  reconcileWorkersMaxOrError,
  runpodBase,
  runpodJobGone,
  terminalErrorInOutput,
} from "../runpod/shared.js";
import { resolveWorkersMax, type RunpodModuleEnv } from "../runpod/env.js";

export type ChainModuleName =
  | "plan-enhance"
  | "cast-image"
  | "image-generate"
  | "dialogue-gen"
  | "speech-upscale"
  | "notify-email";

const CHAIN_MODULES: ReadonlySet<string> = new Set([
  "plan-enhance",
  "cast-image",
  // cf#129: local's own image.generate module. Without it the studio dispatches image generation to
  // a module that does not exist on this host, which is the phase-2 regression this closes.
  "image-generate",
  "dialogue-gen",
  "speech-upscale",
  "notify-email",
]);

export function isChainModuleName(name: string): name is ChainModuleName {
  return CHAIN_MODULES.has(name);
}

async function readJson<T>(store: ArtifactStore, key: string): Promise<T | null> {
  const obj = await store.getBytes(key);
  if (!obj) return null;
  try {
    return JSON.parse(new TextDecoder().decode(obj.bytes)) as T;
  } catch {
    return null;
  }
}

async function writeJson(store: ArtifactStore, key: string, value: unknown): Promise<void> {
  await store.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

export async function invokePlanEnhance(
  env: ChainModuleEnv,
  req: InvokeRequest<PlanEnhanceInput>,
): Promise<InvokeResponse<PlanEnhanceOutput>> {
  const storyboard = req.input?.storyboard;
  if (!storyboard) return { ok: false, error: "plan.enhance: input.storyboard required" };

  const mode = typeof req.config?.mode === "string" ? req.config.mode : "enhance";
  const modelId = typeof req.config?.model === "string" ? req.config.model : undefined;
  const systemMessage =
    typeof req.config?.system_message === "string" ? req.config.system_message.trim() : "";
  const userMessage = typeof req.config?.message === "string" ? req.config.message.trim() : "";

  if (mode === "plan" || mode === "refine") {
    if (!userMessage) {
      return { ok: false, error: `plan.enhance: config.message required for mode ${mode}` };
    }
    let raw: string;
    let modelLabel: string;
    if (plannerAiMockEnabled(env)) {
      raw = mockPlannerRaw(userMessage).response;
      modelLabel = "dev-mock";
    } else {
      const messages: ChatMessage[] = [];
      const system = ollamaConfigured(env)
        ? augmentSystemForOllama(systemMessage, mode)
        : systemMessage;
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: userMessage });
      try {
        const { reply, model } = await directPlanEnhance(env, messages, modelId);
        if (reply == null) {
          return {
            ok: true,
            output: { storyboard, notes: [`${mode} skipped: no model reply`] },
          };
        }
        raw = Array.isArray(reply) ? JSON.stringify(reply) : reply;
        modelLabel = model;
      } catch (e) {
        return {
          ok: true,
          output: { storyboard, notes: [`${mode} skipped: model error (${(e as Error).message})`] },
        };
      }
    }
    const planned = parsePlanStoryboard(raw);
    if (!planned) {
      return {
        ok: true,
        output: { storyboard, notes: [`${mode} skipped: ${modelLabel} reply was not valid storyboard JSON`] },
      };
    }
    return {
      ok: true,
      output: {
        storyboard: planned,
        notes: [`${mode} via ${modelLabel}`],
      },
    };
  }

  if (mode === "chat") {
    if (!userMessage) return { ok: false, error: "plan.enhance: config.message required for chat mode" };
    if (plannerAiMockEnabled(env)) {
      const text = mockPlannerRaw(userMessage).response;
      return { ok: true, output: { storyboard: { scenes: [] }, notes: [text] } };
    }
    const messages: ChatMessage[] = [];
    const system = ollamaConfigured(env)
      ? augmentSystemForOllama(systemMessage, "chat")
      : systemMessage;
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: userMessage });
    try {
      // Chat / ideation: allow thinking models (qwen3, deepseek-r1) to reason.
      const { reply } = await directPlanEnhance(env, messages, modelId, { think: true });
      const text = Array.isArray(reply) ? reply.join("\n") : String(reply ?? "");
      if (!text.trim()) {
        return { ok: true, output: { storyboard: { scenes: [] }, notes: ["chat skipped: empty reply"] } };
      }
      return { ok: true, output: { storyboard: { scenes: [] }, notes: [text] } };
    } catch (e) {
      return { ok: false, error: "plan.enhance chat failed: " + (e as Error).message };
    }
  }

  const prompts = scenePrompts(storyboard);
  if (!prompts) {
    return { ok: false, error: "plan.enhance: input.storyboard has no scenes" };
  }
  const intensity = ((req.config?.intensity as Intensity) || "medium") as Intensity;
  let messages = buildMessages(prompts, intensity);
  if (ollamaConfigured(env) && messages[0]?.role === "system") {
    messages = [
      { role: "system", content: augmentSystemForOllama(messages[0].content, "enhance") },
      ...messages.slice(1),
    ];
  }

  let reply: string | string[] | undefined;
  let model: string;
  try {
    if (plannerAiMockEnabled(env)) {
      const enhanced = mockEnhanced(prompts, intensity);
      return {
        ok: true,
        output: {
          storyboard: mergeEnhanced(storyboard, enhanced),
          notes: [`enhanced ${enhanced.length} shot(s) at ${intensity} intensity via dev-mock`],
        },
      };
    }
    ({ reply, model } = await directPlanEnhance(env, messages, modelId));
  } catch (e) {
    return {
      ok: true,
      output: {
        storyboard,
        notes: [`enhancement skipped: model error (${(e as Error).message})`],
      },
    };
  }

  const enhanced = parseEnhanced(reply, prompts.length);
  if (!enhanced) {
    return {
      ok: true,
      output: {
        storyboard,
        notes: [`enhancement skipped: ${model} reply was not a clean prompt array`],
      },
    };
  }

  return {
    ok: true,
    output: {
      storyboard: mergeEnhanced(storyboard, enhanced),
      notes: [`enhanced ${enhanced.length} shot(s) at ${intensity} intensity via ${model}`],
    },
  };
}

export async function invokeCastImage(
  store: ArtifactStore,
  req: InvokeRequest<CastImageInput>,
): Promise<InvokeResponse<CastImageOutput>> {
  const input = req.input;
  if (!input || typeof input.cast_id !== "number" || !input.portrait_url) {
    return { ok: false, error: "cast.image: input needs cast_id and portrait_url" };
  }
  // Cloud catalog only here (MODELS / DEFAULT_CAST_MODEL). Self-host HF ids are refused by
  // cast-image-model-policy when a local sidecar path is wired; they must never sneak in as
  // the cloud default (local#277 / FLUX Non-Commercial).
  const model =
    typeof req.config?.model === "string" && MODELS.includes(req.config.model as (typeof MODELS)[number])
      ? req.config.model
      : MODELS[0];
  const num = typeof req.config?.num_images === "number" ? req.config.num_images : 10;
  const job_id = crypto.randomUUID();
  const state = buildCastState(input, model, num);
  try {
    await writeJson(store, castStateKey(input.cast_id, job_id), state);
  } catch (e) {
    return { ok: false, error: "cast.image: could not persist run state: " + (e as Error).message };
  }
  return { ok: true, pending: true, poll: encodeCastPoll({ cast_id: input.cast_id, job_id }) };
}

const CAST_IMAGE_PER_POLL = 1;

export async function pollCastImage(
  env: ChainModuleEnv,
  store: ArtifactStore,
  body: PollRequest,
): Promise<PollResponse<CastImageOutput>> {
  const token = decodeCastPoll(body.poll);
  if (!token) return { ok: false, error: "cast.image: bad poll token" };
  const sk = castStateKey(token.cast_id, token.job_id);
  const state = await readJson<CastImageState>(store, sk);
  if (!state) return { ok: false, error: "cast.image: run state not found (expired or bad token)" };
  if (state.prompts.length === 0) return { ok: true, output: readCastOutput(state) };

  for (let i = 0; i < CAST_IMAGE_PER_POLL && state.prompts.length > 0; i++) {
    const prompt = state.prompts[0];
    let img: { bytes: Uint8Array; mime: string };
    try {
      img = await generateCastImage(env, state.model, prompt, state.ref_urls);
    } catch (e) {
      if (isFlaggedError((e as Error).message) && state.model !== FLAG_FALLBACK_MODEL) {
        state.model = FLAG_FALLBACK_MODEL;
        state.fallback_used = true;
        try {
          img = await generateCastImage(env, state.model, prompt, state.ref_urls);
        } catch (e2) {
          return { ok: false, error: "cast.image: generation failed (post-fallback): " + (e2 as Error).message };
        }
      } else {
        return { ok: false, error: "cast.image: generation failed: " + (e as Error).message };
      }
    }
    const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
    const key = refKey(state.cast_id, state.done.length + 1, ext);
    try {
      await store.put(key, img.bytes, { httpMetadata: { contentType: img.mime } });
    } catch (e) {
      return { ok: false, error: "cast.image: store put failed: " + (e as Error).message };
    }
    state.done.push({ key, mime: img.mime });
    state.prompts.shift();
  }

  try {
    await writeJson(store, sk, state);
  } catch {
    /* best-effort: next poll re-reads prior state */
  }

  return state.prompts.length === 0
    ? { ok: true, output: readCastOutput(state) }
    : { ok: true, pending: true };
}

function ttsBytesFromAiResult(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result && typeof (result as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    throw new Error("dialogue: unexpected ReadableStream result (sync TTS only)");
  }
  if (result && typeof result === "object") {
    const o = result as { audio?: string; data?: string };
    const b64 = typeof o.audio === "string" ? o.audio : typeof o.data === "string" ? o.data : "";
    if (b64) return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  throw new Error("dialogue: TTS returned non-audio payload");
}

async function synthDialogueLine(
  env: ChainModuleEnv,
  store: ArtifactStore,
  project: string,
  line: NormalizedLine,
): Promise<DialogueShotAudio> {
  if (!dialogueGatewayConfigured(env)) {
    const wav = buildSilentWav(0.25);
    const key = audioKey(project, line.shot_id);
    await store.put(key, wav, { httpMetadata: { contentType: AUDIO_MIME } });
    return { shot_id: line.shot_id, audio_key: key, voice_id: line.voice };
  }
  const result = await aiRun(env, DIALOGUE_MODEL, buildTtsParams(line.text, line.voice));
  const bytes = ttsBytesFromAiResult(result);
  if (!bytes.byteLength) throw new Error(`dialogue: empty audio for ${line.shot_id}`);
  const key = audioKey(project, line.shot_id);
  await store.put(key, bytes, { httpMetadata: { contentType: AUDIO_MIME } });
  return { shot_id: line.shot_id, audio_key: key, voice_id: line.voice };
}

export async function invokeDialogueGen(
  env: ChainModuleEnv,
  store: ArtifactStore,
  req: InvokeRequest<DialogueInput>,
): Promise<InvokeResponse<DialogueOutput>> {
  const norm = normalizeDialogueInput(req.input);
  if (!norm.ok) return { ok: false, error: "dialogue: " + norm.error };
  if (norm.lines.length === 0) {
    return {
      ok: true,
      output: {
        project: norm.project,
        audio: [],
        applied: dialogueAppliedTags([], { gatewayConfigured: dialogueGatewayConfigured(env) }),
      },
    };
  }
  const jobId = req.context?.job_id || crypto.randomUUID();
  const state: DialogueRunState = {
    status: "running",
    started_at: Math.floor(Date.now() / 1000),
    project: norm.project,
    lines: norm.lines,
    next_index: 0,
    audio: [],
  };
  try {
    await writeJson(store, dialogueStateKey(jobId), state);
  } catch (e) {
    return { ok: false, error: "dialogue: could not persist run state: " + (e as Error).message };
  }
  return { ok: true, pending: true, poll: encodeDialoguePoll({ job_id: jobId }) };
}

export async function pollDialogueGen(
  env: ChainModuleEnv,
  store: ArtifactStore,
  body: PollRequest,
): Promise<PollResponse<DialogueOutput>> {
  const token = decodeDialoguePoll(body.poll);
  if (!token) return { ok: false, error: "dialogue: bad poll token" };
  const sk = dialogueStateKey(token.job_id);
  const state = await readJson<DialogueRunState>(store, sk);
  if (!state) return { ok: false, error: "dialogue: run state not found (expired or bad token)" };
  if (state.status === "done") return { ok: true, output: readDialogueOutput(state) };
  if (state.status === "failed") return { ok: false, error: state.error || "dialogue generation failed" };

  const gatewayConfigured = dialogueGatewayConfigured(env);
  const line = state.lines[state.next_index];
  if (!line) {
    const done: Extract<DialogueRunState, { status: "done" }> = {
      status: "done",
      project: state.project,
      audio: state.audio,
      applied: dialogueAppliedTags(state.audio, { gatewayConfigured }),
    };
    await writeJson(store, sk, done);
    return { ok: true, output: readDialogueOutput(done) };
  }

  try {
    const shot = await synthDialogueLine(env, store, state.project, line);
    state.audio.push(shot);
    state.next_index += 1;
  } catch (e) {
    const failed: Extract<DialogueRunState, { status: "failed" }> = {
      status: "failed",
      error: (e as Error).message.slice(0, 500),
    };
    await writeJson(store, sk, failed);
    return { ok: false, error: failed.error };
  }

  if (state.next_index >= state.lines.length) {
    const done: Extract<DialogueRunState, { status: "done" }> = {
      status: "done",
      project: state.project,
      audio: state.audio,
      applied: dialogueAppliedTags(state.audio, { gatewayConfigured }),
    };
    await writeJson(store, sk, done);
    return { ok: true, output: readDialogueOutput(done) };
  }

  await writeJson(store, sk, state);
  return { ok: true, pending: true };
}

/** Bearer for the on-box doors; same token as the LOCAL_FINISH_* finish doors. */
function localDoorHeaders(env: ChainModuleEnv): Record<string, string> {
  const t = env.LOCAL_FINISH_TOKEN?.trim();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/**
 * Submit to an on-box speech door (local#383).
 *
 * The door serves the RunPod contract (`/run`, `/status/{id}`, `/health`) because it IS the
 * `vivijure-audio-upscale` image behind a serve overlay, so the request body, the status shapes and
 * the output parsing are the RunPod ones unchanged -- the base URL and the credential are the whole
 * difference. Door selection is the shared `door-pool` selector, identical to the finish doors.
 *
 * EVERY FAILURE HERE DEGRADES HONESTLY AND STOPS. It never reaches RunPod: falling back would put
 * the traffic on the endpoint this path exists to take it off, and it would look like success. A
 * degrade is `ok: true` + passthrough + `applied: []` + a named `degraded` reason, because
 * speech-upscale is a POLISH step and a polish miss must not fail the chain (local#249/#77). Only
 * malformed I/O fails loud, which the caller already handles.
 */
async function submitSpeechToLocalDoor(
  env: ChainModuleEnv,
  input: SpeechInput,
  cfg: ReturnType<typeof coerceSpeechConfig>,
  project: string,
): Promise<InvokeResponse<SpeechOutput>> {
  const { urls, dropped } = normalizeDoorBaseUrls(speechLocalDoorRaw(env));
  if (dropped > 0) {
    // Never silent: a dropped entry is lost capacity, and the operator's variable looks fine.
    console.warn(
      `speech-upscale: ${dropped} unusable entr${dropped === 1 ? "y" : "ies"} dropped from ` +
        `LOCAL_FINISH_SPEECH_URL; ${urls.length} usable`,
    );
  }
  if (urls.length === 0) {
    // SET BUT UNUSABLE is not UNSET -- see resolveSpeechBackend. Stopping here is the point.
    return {
      ok: true,
      output: speechPassthrough(input, "local-door-unusable", `LOCAL_FINISH_SPEECH_URL yielded 0 usable doors`),
    };
  }
  const ordered = await orderDoors(urls);
  if (ordered.length === 0) {
    // DISTINGUISHABLE FROM UNUSABLE: "configured but nothing answers" and "configured wrong" are
    // different facts and an operator acts differently on each.
    return {
      ok: true,
      output: speechPassthrough(
        input,
        "local-door-unreachable",
        `${urls.length} configured, 0 reachable`,
      ),
    };
  }
  let lastError = "";
  for (let i = 0; i < ordered.length; i += 1) {
    const baseUrl = ordered[i];
    try {
      const r = await fetch(`${baseUrl}/run`, {
        method: "POST",
        headers: { ...localDoorHeaders(env), "content-type": "application/json" },
        body: JSON.stringify(buildRunPodBody(input, cfg, project)),
      });
      if (!r.ok) {
        lastError = `local speech door /run -> ${r.status}`;
        continue;
      }
      const jobId = ((await r.json()) as { id?: string }).id;
      if (!jobId) {
        lastError = "local speech door /run returned no job id";
        continue;
      }
      if (i > 0) {
        // A silent retry turns a permanently dead card into an invisible capacity loss, so both
        // doors are always named.
        console.warn(
          `speech-upscale: local door failed over -- ${ordered[i - 1]} did not serve ` +
            `(${lastError}); ${baseUrl} did`,
        );
      }
      return {
        ok: true,
        pending: true,
        jobId,
        poll: encodeSpeechPoll({
          jobId,
          shotId: input.shot_id,
          audioKey: input.audio_key,
          submittedAt: Date.now(),
          doorUrl: baseUrl,
        }),
      };
    } catch (e) {
      lastError = `local speech door submit error: ${(e as Error).message}`;
    }
  }
  return { ok: true, output: speechPassthrough(input, "local-door-submit-failed", lastError) };
}

export async function invokeSpeechUpscale(
  env: ChainModuleEnv,
  store: ArtifactStore,
  req: InvokeRequest<SpeechInput>,
): Promise<InvokeResponse<SpeechOutput>> {
  const input = req.input;
  if (!input?.shot_id || !input?.audio_key) {
    return { ok: false, error: "speech-upscale: input needs shot_id and audio_key" };
  }
  const cfg = coerceSpeechConfig(req.config);
  if (!cfg.enable) {
    return { ok: true, output: speechPassthrough(input, "disabled") };
  }
  const backend = resolveSpeechBackend(env);
  if (backend === "local-door") {
    return submitSpeechToLocalDoor(env, input, cfg, req.context.project);
  }
  if (backend === "mock") {
    const output = await processSpeechLocal(store, input, cfg);
    return { ok: true, output };
  }
  const apiKey = env.RUNPOD_API_KEY!;
  const endpointId = speechRunpodEndpointId(env)!;
  const rec = await reconcileWorkersMaxOrError(
    "speech-upscale",
    apiKey,
    endpointId,
    resolveWorkersMax(env as RunpodModuleEnv),
  );
  if (!rec.ok) return { ok: false, error: rec.error };
  const base = runpodBase(endpointId);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(apiKey), "content-type": "application/json" },
      body: JSON.stringify(buildRunPodBody(input, cfg, req.context.project)),
    });
    if (!r.ok) {
      return { ok: true, output: speechPassthrough(input, "runpod-run-failed", `HTTP ${r.status}`) };
    }
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: true, output: speechPassthrough(input, "no-jobid") };
    return {
      ok: true,
      pending: true,
      jobId,
      poll: encodeSpeechPoll({
        jobId,
        shotId: input.shot_id,
        audioKey: input.audio_key,
        submittedAt: Date.now(),
      }),
    };
  } catch (e) {
    return { ok: true, output: speechPassthrough(input, "exception", (e as Error).message) };
  }
}

export async function pollSpeechUpscale(
  env: ChainModuleEnv,
  body: PollRequest,
): Promise<PollResponse<SpeechOutput>> {
  const st = decodeSpeechPoll(body.poll);
  if (!st) return { ok: false, error: "speech-upscale: bad poll token" };

  // AFFINITY, not rotation (local#383): the job id lives in the SERVING door's in-process registry,
  // so polling any other door 404s and would read a healthy job as gone. A token naming a door no
  // longer configured falls back to the head of the current pool -- which is exactly the
  // single-door behaviour it was minted under. A token with no `doorUrl` predates the local door,
  // or was minted against RunPod, and takes the RunPod path below unchanged.
  const localDoors = normalizeDoorBaseUrls(speechLocalDoorRaw(env)).urls;
  const localBase = st.doorUrl
    ? st.doorUrl && localDoors.includes(st.doorUrl)
      ? st.doorUrl
      : localDoors[0]
    : undefined;
  if (st.doorUrl && !localBase) {
    // The operator unset the door mid-flight. Refusing to guess is the honest answer; a poll against
    // RunPod here would resurrect the traffic this path exists to remove.
    return {
      ok: true,
      output: speechPassthrough(
        { shot_id: st.shotId, audio_key: st.audioKey },
        "local-door-unconfigured-mid-job",
      ),
    };
  }

  if (!localBase && !speechRunpodConfigured(env)) {
    return { ok: false, error: "speech-upscale local mock completes synchronously on /invoke" };
  }
  const apiKey = env.RUNPOD_API_KEY;
  const base = localBase ?? runpodBase(speechRunpodEndpointId(env)!);
  const pollHeaders = localBase ? localDoorHeaders(env) : authHeader(apiKey!);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: pollHeaders });
    httpStatus = resp.status;
    s = (await resp.json()) as typeof s;
  } catch {
    return { ok: true, pending: true };
  }
  const passthrough = (reason: string, detail?: string) => ({
    ok: true as const,
    output: speechPassthrough({ shot_id: st.shotId, audio_key: st.audioKey }, reason, detail),
  });
  if (runpodJobGone(httpStatus, s)) {
    if (classifyGoneState(st.submittedAt, Date.now()) === "gone-failed") {
      return passthrough("endpoint-gone");
    }
    return { ok: true, pending: true };
  }
  if (s.status === "FAILED") {
    return passthrough("endpoint-failed", JSON.stringify(s.error ?? s).slice(0, 160));
  }
  if (s.status !== "COMPLETED") {
    const backendErr = terminalErrorInOutput(s.output);
    if (backendErr) {
      // Best-effort cancel is a RunPod API call; the on-box door has no such endpoint, so skipping
      // it there is correct rather than a gap. The degrade below is identical either way.
      if (!localBase && apiKey) await cancelRunpodJobBestEffort(apiKey, base, st.jobId);
      return passthrough("endpoint-error", backendErr.slice(0, 160));
    }
    return { ok: true, pending: true };
  }
  const out = parseSpeechBackendOutput(s.output);
  if (!out?.output_key) return passthrough("no-output-key");
  return {
    ok: true,
    output: successRunpodOutput(st, out, localBase ? "speech-upscale:local-door" : undefined),
  };
}

export async function invokeNotifyEmail(
  req: InvokeRequest<NotifyInput>,
): Promise<InvokeResponse<NotifyOutput>> {
  const input = req.input;
  if (!input || input.event !== "render.complete") {
    return { ok: false, error: "notify-email: unsupported event " + String(input?.event) };
  }
  const to = typeof req.config?.notify_email === "string" ? req.config.notify_email.trim() : "";
  if (!to) return { ok: true, output: { delivered: [] } };
  const { subject, html, text } = renderCompleteEmail(input);
  // #50: this local build has NO email transport -- it only logs the rendered message. Report `delivered: []`
  // HONESTLY instead of `["email:" + to]`, which claimed a delivery that never happened (the studio would
  // record a completion email the user never receives). A real send (postern / CF Email / SMTP) is a separate
  // feature; until then the honest output is "nothing delivered". The log below keeps the content visible to
  // the operator running the stub.
  // cf#223: this line used to print the RECIPIENT ADDRESS, the SUBJECT and 200 characters of the
  // body -- which is to say an email address plus the film and project names the customer chose. It
  // is a deliberate exception to "log lines carry no content" (the stub has no transport, so the log
  // IS the delivery) and that made it the single largest content leak in this panel.
  //
  // The resolution keeps both properties instead of trading one away: content-free BY DEFAULT, and
  // the operator of a self-hosted box can opt IN to seeing the message they are not otherwise able
  // to read. Opt-in rather than opt-out because the default is what a hosted deploy and an
  // unattended box both get, and a default that leaks is not a default anybody chose.
  const showStubContent = String(process.env.VIVIJURE_LOG_STUB_EMAIL ?? "").trim() === "true";
  console.log(
    JSON.stringify({
      event: "notify-email",
      note: showStubContent
        ? "local stub: logged only, not delivered"
        : "local stub: logged only, not delivered (content hidden; set VIVIJURE_LOG_STUB_EMAIL=true to print it)",
      to_label: untrustedLabel(to),
      from: FROM.email,
      subject_length: subject.length,
      text_length: text.length,
      html_length: html.length,
      ...(showStubContent ? { to, subject, text_preview: text.slice(0, 200) } : {}),
    }),
  );
  return { ok: true, output: { delivered: [] } };
}
