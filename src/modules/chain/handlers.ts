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
import { MIN_PNG, buildSilentWav } from "../../dev/minimal-media.js";
import { plannerAiMockEnabled } from "../../planner-ai-mock.js";
import type { ChainModuleEnv } from "./chain-env.js";
import {
  MODELS,
  buildState as buildCastState,
  decodePoll as decodeCastPoll,
  encodePoll as encodeCastPoll,
  readOutput as readCastOutput,
  refKey,
  stateKey as castStateKey,
  type CastImageState,
} from "./cast-image-core.js";
import {
  AUDIO_MIME,
  appliedTags as dialogueAppliedTags,
  audioKey,
  decodePoll as decodeDialoguePoll,
  encodePoll as encodeDialoguePoll,
  normalizeInput as normalizeDialogueInput,
  readOutput as readDialogueOutput,
  stateKey as dialogueStateKey,
  type RunState as DialogueRunState,
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

export type ChainModuleName =
  | "plan-enhance"
  | "cast-image"
  | "dialogue-gen"
  | "speech-upscale"
  | "notify-email";

const CHAIN_MODULES: ReadonlySet<string> = new Set([
  "plan-enhance",
  "cast-image",
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

export async function pollCastImage(
  store: ArtifactStore,
  body: PollRequest,
): Promise<PollResponse<CastImageOutput>> {
  const token = decodeCastPoll(body.poll);
  if (!token) return { ok: false, error: "cast.image: bad poll token" };
  const sk = castStateKey(token.cast_id, token.job_id);
  const state = await readJson<CastImageState>(store, sk);
  if (!state) return { ok: false, error: "cast.image: run state not found (expired or bad token)" };
  if (state.prompts.length === 0) return { ok: true, output: readCastOutput(state) };

  const key = refKey(state.cast_id, state.done.length + 1, "png");
  await store.put(key, MIN_PNG, { httpMetadata: { contentType: "image/png" } });
  state.done.push({ key, mime: "image/png" });
  state.prompts.shift();
  await writeJson(store, sk, state);

  return state.prompts.length === 0
    ? { ok: true, output: readCastOutput(state) }
    : { ok: true, pending: true };
}

export async function invokeDialogueGen(
  store: ArtifactStore,
  req: InvokeRequest<DialogueInput>,
): Promise<InvokeResponse<DialogueOutput>> {
  const norm = normalizeDialogueInput(req.input);
  if (!norm.ok) return { ok: false, error: "dialogue: " + norm.error };
  if (norm.lines.length === 0) {
    return { ok: true, output: { project: norm.project, audio: [], applied: dialogueAppliedTags([]) } };
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

  const line = state.lines[state.next_index];
  if (!line) {
    const done: Extract<DialogueRunState, { status: "done" }> = {
      status: "done",
      project: state.project,
      audio: state.audio,
      applied: dialogueAppliedTags(state.audio),
    };
    await writeJson(store, sk, done);
    return { ok: true, output: readDialogueOutput(done) };
  }

  const wav = buildSilentWav(0.25);
  const key = audioKey(state.project, line.shot_id);
  await store.put(key, wav, { httpMetadata: { contentType: AUDIO_MIME } });
  const shot: DialogueShotAudio = { shot_id: line.shot_id, audio_key: key, voice_id: line.voice };
  state.audio.push(shot);
  state.next_index += 1;

  if (state.next_index >= state.lines.length) {
    const done: Extract<DialogueRunState, { status: "done" }> = {
      status: "done",
      project: state.project,
      audio: state.audio,
      applied: dialogueAppliedTags(state.audio),
    };
    await writeJson(store, sk, done);
    return { ok: true, output: readDialogueOutput(done) };
  }

  await writeJson(store, sk, state);
  return { ok: true, pending: true };
}

export async function invokeSpeechUpscale(
  store: ArtifactStore,
  req: InvokeRequest<SpeechInput>,
): Promise<InvokeResponse<SpeechOutput>> {
  const input = req.input;
  if (!input?.shot_id || !input?.audio_key) {
    return { ok: false, error: "speech-upscale: input needs shot_id and audio_key" };
  }
  const cfg = coerceSpeechConfig(req.config);
  const output = await processSpeechLocal(store, input, cfg);
  return { ok: true, output };
}

export async function pollSpeechUpscale(_body: PollRequest): Promise<PollResponse<SpeechOutput>> {
  return { ok: false, error: "speech-upscale local mock completes synchronously on /invoke" };
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
  console.log(
    JSON.stringify({
      event: "notify-email",
      to,
      from: FROM.email,
      subject,
      text_preview: text.slice(0, 200),
      html_length: html.length,
    }),
  );
  return { ok: true, output: { delivered: ["email:" + to] } };
}
