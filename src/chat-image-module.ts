// POST /api/chat image generation, dispatched to an installed image.generate module (cf#129 ph2).
//
// The studio holds no image model names and no provider routing: it resolves the chosen model id to
// the module that DECLARED it and invokes the hook. Identical mechanism to chatComplete for text,
// with no special-casing of any module name, so a third-party image module works on the same path.
//
// THE CORE OWNS PERSISTENCE. The module returns bytes and holds no bucket binding; this file writes
// them. That is the vivijure-cf#140 fix made structural: artifacts were written to one store and
// served from another, so every preview 404'd in production while every gate stayed green. Here the
// SAME store that serves /api/artifact is the one written to, and it is passed in as a single
// argument so the two cannot drift apart.

import { invokeModule, resolveFetcher, validateConfig, type RegisteredModule } from "@skyphusion-labs/vivijure-core";
import type { ObjectStore } from "./platform/types.js";
import { putChatArtifact, type OutputArtifact } from "./chat-artifacts.js";
import { resolveCatalogTarget } from "./module-catalog.js";

export interface ChatImageArgs {
  model: string;
  user_input: string;
  system_prompt?: string;
  attachments?: Array<{ type?: string; data?: string; mime?: string; filename?: string }>;
}

export type ChatImageResult =
  | {
      ok: true;
      model: string;
      output: string;
      output_artifact: OutputArtifact;
      latency_ms: number;
      ai_gateway_log_id: string | null;
      module: string;
    }
  | { ok: false; error: string; model: string };

interface ImageGenerateOutput {
  image?: { bytes_b64?: string; mime?: string };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reference images the caller attached, as data: URLs (what the panel sends). */
function attachmentDataUrls(args: ChatImageArgs): string[] {
  const out: string[] = [];
  for (const att of args.attachments ?? []) {
    if (att.type !== "image" || !att.data) continue;
    if (att.data.startsWith("data:")) out.push(att.data);
    else if (att.mime) out.push(`data:${att.mime};base64,${att.data}`);
  }
  return out;
}

export async function chatImageViaModule(
  modEnv: Record<string, unknown>,
  modules: RegisteredModule[],
  /** The store /api/artifact SERVES. Not "a" store -- the served one (cf#140). */
  servedStore: ObjectStore,
  args: ChatImageArgs,
): Promise<ChatImageResult> {
  const target = resolveCatalogTarget(modules, "image.generate", args.model);
  if (!target) {
    // Honest fail, naming the model: no installed module declares it. Never a fake success and
    // never a silent substitution of some other model the user did not pick.
    return {
      ok: false,
      error: `no image.generate module serves model "${args.model}" (install an image module)`,
      model: args.model,
    };
  }
  const mod = modules.find((m) => m.name === target.moduleName);
  if (!mod) return { ok: false, error: `image module ${target.moduleName} not found`, model: args.model };

  const fetcher = resolveFetcher(modEnv, mod.binding);
  if (!fetcher) {
    return { ok: false, error: `image module ${mod.name} (${mod.binding}) is not bound`, model: args.model };
  }

  const start = Date.now();
  const r = await invokeModule<Record<string, unknown>, ImageGenerateOutput>(fetcher, {
    hook: "image.generate",
    input: {
      prompt: args.user_input,
      // The chat composer's "system prompt" field is the negative prompt on the image path; that is
      // what it always meant here, and the module contract now names it honestly.
      negative_prompt: args.system_prompt,
      refs: attachmentDataUrls(args),
    },
    config: {
      ...validateConfig(mod.config_schema, {}),
      model: target.configModel ?? target.modelId,
    },
    context: { project: "chat", job_id: crypto.randomUUID() },
  });

  if (!r.ok) {
    return {
      ok: false,
      error: ("error" in r ? r.error : undefined) || "image module returned no output",
      model: args.model,
    };
  }

  // A module MAY answer async (ok:true + pending + poll). This path does not poll: chat image
  // generation is a single request-scoped call and the panel waits on it. Rejecting with a named
  // reason is honest; silently treating a pending envelope as a result would store nothing and
  // report success, which is the exact shape of the defect class this sprint exists to remove.
  if ("pending" in r) {
    return {
      ok: false,
      error: `image module ${mod.name} answered asynchronously (pending/poll), which the chat image path does not support`,
      model: args.model,
    };
  }

  const image = r.output?.image;
  if (!image?.bytes_b64 || !image.mime) {
    // Envelope-correct but payload-broken: the core must not store a non-picture as if it worked.
    return { ok: false, error: `image module ${mod.name} returned no image bytes`, model: args.model };
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(image.bytes_b64);
  } catch {
    return { ok: false, error: `image module ${mod.name} returned undecodable base64`, model: args.model };
  }
  if (!bytes.length) {
    return { ok: false, error: `image module ${mod.name} returned zero bytes`, model: args.model };
  }

  const output_artifact = await putChatArtifact(servedStore, image.mime, bytes);
  return {
    ok: true,
    model: args.model,
    output: "",
    output_artifact,
    latency_ms: Date.now() - start,
    ai_gateway_log_id: null,
    module: mod.name,
  };
}
