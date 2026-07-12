// Image generation for POST /api/chat (cast portrait + multi-scene preview).

import type { ObjectStore } from "./platform/types.js";
import { aiRun, aiLogId } from "./platform/ai-run.js";
import type { AiGatewayEnv } from "./platform/ai-gateway.js";
import { detectProviderFailure, extractProxiedImageUrl } from "./output-extract.js";
import { buildProxiedImageParams, isFlux2, proxiedParams, sniffImageMime } from "./chat-image-gen.js";
import type { ModelEntry } from "./models.js";
import { findImageModel } from "./image-models.js";
import { putChatArtifact } from "./chat-artifacts.js";
import { generateOpenAIImage } from "./providers/openai-image.js";
import { base64ToBytes, parseDataUrl } from "./utils.js";

export interface ChatImageAttachment {
  type?: string;
  data?: string;
  mime?: string;
  filename?: string;
}

export interface ChatImageArgs {
  model: string;
  user_input: string;
  system_prompt?: string;
  attachments?: ChatImageAttachment[];
}

export type ChatImageResult =
  | {
      ok: true;
      model: string;
      output: string;
      output_artifact: import("./chat-artifacts.js").OutputArtifact;
      latency_ms: number;
      ai_gateway_log_id: string | null;
    }
  | { ok: false; error: string; model: string };

export interface ChatImageEnv extends AiGatewayEnv {
  OPENAI_API_KEY?: string;
}

function attachmentDataUrls(attachments: ChatImageAttachment[] | undefined): string[] {
  const out: string[] = [];
  for (const att of attachments ?? []) {
    if (att.type !== "image" || !att.data) continue;
    if (att.data.startsWith("data:")) {
      out.push(att.data);
    } else if (att.mime) {
      out.push(`data:${att.mime};base64,${att.data}`);
    }
  }
  return out;
}

async function readStreamBody(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}

async function generateImageBytes(
  env: ChatImageEnv,
  model: ModelEntry,
  args: ChatImageArgs,
): Promise<{ bytes: Uint8Array; mime: string; logId: string | null }> {
  if (model.provider) {
    if (model.provider === "openai" && env.OPENAI_API_KEY) {
      const { bytes, mime } = await generateOpenAIImage(env.OPENAI_API_KEY, model.id, args.user_input);
      return { bytes, mime, logId: null };
    }
    const refs = attachmentDataUrls(args.attachments);
    const params = refs.length
      ? proxiedParams(model.id, args.user_input, refs)
      : buildProxiedImageParams(model.provider, args.user_input);
    const result = await aiRun(env, model.id, params);
    const logId = aiLogId();
    const failure = detectProviderFailure(result);
    if (failure) throw new Error(`Image generation failed: ${failure}`);
    const imageUrl = extractProxiedImageUrl(result);
    if (!imageUrl) throw new Error("Image generation returned no image URL");
    const aresp = await fetch(imageUrl);
    if (!aresp.ok) throw new Error(`Failed to fetch generated image: ${aresp.status}`);
    const bytes = new Uint8Array(await aresp.arrayBuffer());
    return { bytes, mime: aresp.headers.get("content-type") || "image/png", logId };
  }

  const isSdxl = model.id === "@cf/stabilityai/stable-diffusion-xl-base-1.0";
  const bypassGateway =
    isFlux2(model.id) ||
    model.id === "@cf/leonardo/phoenix-1.0" ||
    model.id === "@cf/lykon/dreamshaper-8-lcm" ||
    isSdxl;

  let runParams: unknown;
  if (isFlux2(model.id)) {
    const form = new FormData();
    form.append("prompt", args.user_input);
    form.append("width", "1024");
    form.append("height", "1024");
    if (args.system_prompt?.trim()) {
      form.append("negative_prompt", args.system_prompt);
    }
    let refIdx = 0;
    for (const att of args.attachments ?? []) {
      if (refIdx >= 4) break;
      if (att.type !== "image" || !att.data) continue;
      const parsed = parseDataUrl(att.data.startsWith("data:") ? att.data : `data:${att.mime || "image/png"};base64,${att.data}`);
      if (!parsed) continue;
      const blob = new Blob([new Uint8Array(base64ToBytes(parsed.base64))], { type: parsed.mime });
      form.append(`input_image_${refIdx}`, blob, att.filename || `ref-${refIdx}.png`);
      refIdx++;
    }
    runParams = { formData: form };
  } else {
    const params: Record<string, unknown> = {
      prompt: args.user_input,
      width: 1024,
      height: 1024,
      steps: 25,
    };
    if (args.system_prompt?.trim()) params.negative_prompt = args.system_prompt;
    if (model.id === "@cf/black-forest-labs/flux-1-schnell") {
      params.steps = 4;
      delete params.negative_prompt;
    }
    if (isSdxl) {
      delete params.steps;
      params.num_steps = 20;
    }
    runParams = params;
  }

  const result = await aiRun(env, model.id, runParams);
  const logId = bypassGateway ? null : aiLogId();

  if (result instanceof ReadableStream) {
    const bytes = await readStreamBody(result);
    return { bytes, mime: "image/png", logId };
  }

  const b64 = (result as { image?: string })?.image;
  if (!b64 || typeof b64 !== "string") {
    throw new Error("Image generation returned no image");
  }
  const bytes = base64ToBytes(b64);
  const mime = isFlux2(model.id) ? sniffImageMime(bytes).mime : "image/jpeg";
  return { bytes, mime, logId };
}

export async function chatImage(
  store: ObjectStore,
  env: ChatImageEnv,
  args: ChatImageArgs,
): Promise<ChatImageResult> {
  const model = findImageModel(args.model);
  if (!model || model.type !== "image") {
    return { ok: false, error: `model "${args.model}" is not an image model`, model: args.model };
  }
  const start = Date.now();
  try {
    const { bytes, mime, logId } = await generateImageBytes(env, model, args);
    const output_artifact = await putChatArtifact(store, mime, bytes);
    return {
      ok: true,
      model: model.id,
      output: "",
      output_artifact,
      latency_ms: Date.now() - start,
      ai_gateway_log_id: logId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, model: args.model };
  }
}
