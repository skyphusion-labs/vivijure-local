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
import { speechRunpodConfigured, speechRunpodEndpointId } from "./chain-env.js";
import {
  authHeader,
  cancelRunpodJobBestEffort,
  classifyGoneState,
  runpodBase,
  runpodJobGone,
  terminalErrorInOutput,
} from "../runpod/shared.js";

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
      if (systemMessage) messages.push({ role: "system", content: systemMessage });
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
    if (systemMessage) messages.push({ role: "system", content: systemMessage });
    messages.push({ role: "user", content: userMessage });
    try {
      const { reply } = await directPlanEnhance(env, messages, modelId);
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
  const messages = buildMessages(prompts, intensity);

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
  if (!speechRunpodConfigured(env)) {
    const output = await processSpeechLocal(store, input, cfg);
    return { ok: true, output };
  }
  const apiKey = env.RUNPOD_API_KEY!;
  const endpointId = speechRunpodEndpointId(env)!;
  const base = runpodBase(endpointId);
  try {
    const r = await fetch(`${base}/run`, {
      method: "POST",
      headers: { ...authHeader(apiKey), "content-type": "application/json" },
      body: JSON.stringify(buildRunPodBody(input, cfg)),
    });
    if (!r.ok) {
      return { ok: true, output: speechPassthrough(input, "runpod-run-failed", `HTTP ${r.status}`) };
    }
    const jobId = ((await r.json()) as { id?: string }).id;
    if (!jobId) return { ok: true, output: speechPassthrough(input, "no-jobid") };
    return {
      ok: true,
      pending: true,
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
  if (!speechRunpodConfigured(env)) {
    return { ok: false, error: "speech-upscale local mock completes synchronously on /invoke" };
  }
  const apiKey = env.RUNPOD_API_KEY!;
  const endpointId = speechRunpodEndpointId(env)!;
  const base = runpodBase(endpointId);
  let httpStatus = 0;
  let s: { status?: string; output?: unknown; error?: unknown };
  try {
    const resp = await fetch(`${base}/status/${st.jobId}`, { headers: authHeader(apiKey) });
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
      await cancelRunpodJobBestEffort(apiKey, base, st.jobId);
      return passthrough("endpoint-error", backendErr.slice(0, 160));
    }
    return { ok: true, pending: true };
  }
  const out = parseSpeechBackendOutput(s.output);
  if (!out?.output_key) return passthrough("no-output-key");
  return { ok: true, output: successRunpodOutput(st, out) };
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
  console.log(
    JSON.stringify({
      event: "notify-email",
      note: "local stub: logged only, not delivered",
      to,
      from: FROM.email,
      subject,
      text_preview: text.slice(0, 200),
      html_length: html.length,
    }),
  );
  return { ok: true, output: { delivered: [] } };
}
