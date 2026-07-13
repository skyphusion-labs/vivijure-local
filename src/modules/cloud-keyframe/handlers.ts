import type {
  InvokeRequest,
  InvokeResponse,
  KeyframeInput,
  KeyframeOutput,
  PollRequest,
  PollResponse,
} from "@skyphusion-labs/vivijure-core";
import type { ArtifactStore } from "../../platform/create-storage.js";
import type { AiGatewayEnv } from "../../platform/ai-gateway.js";
import { aiGatewayConfigured } from "../../platform/ai-gateway.js";
import {
  extractTarBytes,
  extractTarText,
  gunzipBundle,
  listTarNames,
  parseRegistry,
  parseScenes,
  parseStylePrefix,
  refsForSlot,
} from "./bundle-core.js";
import { generateCloudKeyframeImage } from "./image-gen.js";
import {
  clampDim,
  clampModel,
  clampRefsPerSlot,
  composePrompt,
  decodePoll,
  encodePoll,
  keyframeKey,
  readOutput,
  selectScenes,
  stageRefKey,
  stateKey,
  usedSlots,
  type CloudKeyframeState,
  type ShotPlan,
} from "./keyframe-core.js";

export interface CloudKeyframeEnv extends AiGatewayEnv {
  GATEWAY_ID?: string;
}

export function cloudKeyframeEnvFromProcess(env: NodeJS.ProcessEnv): CloudKeyframeEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined,
    GATEWAY_ID: env.GATEWAY_ID?.trim() || "vivijure",
    CF_AIG_TOKEN: env.CF_AIG_TOKEN?.trim() || undefined,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN?.trim() || undefined,
  };
}

export function cloudKeyframeEnvFromRuntime(runtime: { asProcessEnv(): NodeJS.ProcessEnv }): CloudKeyframeEnv {
  return cloudKeyframeEnvFromProcess(runtime.asProcessEnv());
}

const PER_POLL = 1;

function gatewayId(env: CloudKeyframeEnv): string | undefined {
  return env.GATEWAY_ID?.trim() || undefined;
}

/** Best-effort ref downscale without Cloudflare Images; pass through when oversized. */
async function downscaleRef(bytes: Uint8Array): Promise<Uint8Array> {
  return bytes;
}

async function readState(store: ArtifactStore, sk: string): Promise<CloudKeyframeState | null> {
  const raw = await store.get(sk);
  if (!raw) return null;
  return JSON.parse(new TextDecoder().decode(raw)) as CloudKeyframeState;
}

async function writeState(store: ArtifactStore, sk: string, state: CloudKeyframeState): Promise<void> {
  await store.put(sk, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });
}

export async function invokeCloudKeyframe(
  store: ArtifactStore,
  env: CloudKeyframeEnv,
  req: InvokeRequest<KeyframeInput>,
): Promise<InvokeResponse<KeyframeOutput>> {
  const input = req.input;
  if (!input?.project || !input.bundle_key) {
    return { ok: false, error: "cloud-keyframe: input needs project and bundle_key" };
  }
  if (!aiGatewayConfigured(env)) {
    return {
      ok: false,
      error: "cloud-keyframe: AI Gateway not configured (CLOUDFLARE_ACCOUNT_ID + CF_AIG_TOKEN)",
    };
  }
  const model = clampModel(req.config?.model);
  const gw = gatewayId(env);
  if (model.startsWith("google/") && !gw) {
    return { ok: false, error: "cloud-keyframe: GATEWAY_ID not configured (required for proxied models)" };
  }
  const width = clampDim(req.config?.width, 1344);
  const height = clampDim(req.config?.height, 768);
  const refsPerSlot = clampRefsPerSlot(req.config?.refs_per_slot);

  let tar: Uint8Array | null;
  try {
    tar = await gunzipBundle(store, input.bundle_key);
  } catch (e) {
    return { ok: false, error: "cloud-keyframe: could not read bundle: " + (e as Error).message };
  }
  if (!tar) return { ok: false, error: "cloud-keyframe: bundle not found at " + input.bundle_key };

  const yaml = extractTarText(tar, "storyboard.yaml");
  if (!yaml) return { ok: false, error: "cloud-keyframe: bundle has no storyboard.yaml" };
  const scenes = parseScenes(yaml);
  const stylePrefix = parseStylePrefix(yaml);
  const registryJson = extractTarText(tar, "characters/registry.json");
  const registry = registryJson ? parseRegistry(registryJson) : {};

  const selected = selectScenes(scenes, input.shot_ids);
  if (selected.length === 0) {
    return { ok: false, error: "cloud-keyframe: no shots to render (empty storyboard or no matching shot_ids)" };
  }

  const job_id = crypto.randomUUID();
  const tarNames = listTarNames(tar);
  const slot_refs: Record<string, string[]> = {};
  for (const slot of usedSlots(selected)) {
    const candidates: string[] = [];
    const reg = registry[slot];
    if (reg?.image) candidates.push(reg.image);
    for (const r of refsForSlot(tarNames, slot)) {
      if (!candidates.includes(r)) candidates.push(r);
    }
    const chosen = candidates.slice(0, refsPerSlot);
    const keys: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const raw = extractTarBytes(tar, chosen[i]);
      if (!raw) continue;
      const small = await downscaleRef(raw);
      const key = stageRefKey(input.project, job_id, slot, i + 1);
      try {
        await store.put(key, small, { httpMetadata: { contentType: "image/png" } });
      } catch (e) {
        return { ok: false, error: "cloud-keyframe: could not stage ref for slot " + slot + ": " + (e as Error).message };
      }
      keys.push(key);
    }
    if (keys.length === 0) {
      return {
        ok: false,
        error: "cloud-keyframe: slot " + slot + " has no portrait in the bundle (cannot render its shots)",
      };
    }
    slot_refs[slot] = keys;
  }

  const shots: ShotPlan[] = selected.map((s) => ({
    shot_id: s.shot_id,
    prompt: composePrompt(stylePrefix, s.prompt, s.slots, registry),
    slots: s.slots,
  }));

  const state: CloudKeyframeState = {
    project: input.project,
    job_id,
    model,
    width,
    height,
    slot_refs,
    shots,
    done: [],
    total: shots.length,
  };
  try {
    await writeState(store, stateKey(input.project, job_id), state);
  } catch (e) {
    return { ok: false, error: "cloud-keyframe: could not persist run state: " + (e as Error).message };
  }
  return {
    ok: true,
    pending: true,
    poll: encodePoll({ project: input.project, job_id }),
    jobId: job_id,
  };
}

export async function pollCloudKeyframe(
  store: ArtifactStore,
  env: CloudKeyframeEnv,
  body: PollRequest,
): Promise<PollResponse<KeyframeOutput>> {
  const token = decodePoll(body.poll);
  if (!token) return { ok: false, error: "cloud-keyframe: bad poll token" };
  const sk = stateKey(token.project, token.job_id);
  const state = await readState(store, sk);
  if (!state) return { ok: false, error: "cloud-keyframe: run state not found (expired or bad token)" };
  if (state.shots.length === 0) return { ok: true, output: readOutput(state) };

  for (let n = 0; n < PER_POLL && state.shots.length > 0; n++) {
    const shot = state.shots[0];
    const refBlobs: Blob[] = [];
    for (const slot of shot.slots) {
      for (const key of state.slot_refs[slot] || []) {
        const bytes = await store.get(key);
        if (bytes) refBlobs.push(new Blob([bytes]));
      }
    }
    if (shot.slots.length > 0 && refBlobs.length === 0) {
      return { ok: false, error: "cloud-keyframe: shot " + shot.shot_id + " lost its staged references" };
    }

    let gen: { bytes: Uint8Array; mime: string };
    try {
      gen = await generateCloudKeyframeImage(env, state.model, shot.prompt, refBlobs, state.width, state.height);
    } catch (e) {
      return { ok: false, error: "cloud-keyframe: shot " + shot.shot_id + " render failed: " + (e as Error).message };
    }

    const key = keyframeKey(state.project, shot.shot_id);
    try {
      await store.put(key, gen.bytes, { httpMetadata: { contentType: gen.mime } });
    } catch (e) {
      return { ok: false, error: "cloud-keyframe: shot " + shot.shot_id + " store put failed: " + (e as Error).message };
    }

    state.done.push({ shot_id: shot.shot_id, keyframe_key: key });
    state.shots.shift();
  }

  try {
    await writeState(store, sk, state);
  } catch {
    /* best-effort */
  }
  return state.shots.length === 0 ? { ok: true, output: readOutput(state) } : { ok: true, pending: true };
}
