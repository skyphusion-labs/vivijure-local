/**
 * cast.image against an on-box door (local#269, under epic local#200).
 *
 * THE PANEL HALF of the Apache-licensed homelab path. `containers/cast-image` (landed by
 * local#480, closing local#398) already serves FLUX.2 Klein 4B over HTTP and refuses every
 * other weight id; nothing in the panel called it. This file is the caller.
 *
 * THE DOOR CONTRACT, read from containers/cast-image/app.py rather than from a doc:
 *   POST /generate  { prompt, width, height, ref_images: [b64...], model }
 *                     -> 200 { image: <b64 png>, mime, model, revision }
 *                     -> 503 when the host has no CUDA (the honest "built, not usable" state)
 *                     -> 400 on an empty prompt or a model id outside the allowlist
 *   POST /unload    -> { ok: true }  (drop the pipeline so the card goes back to Ollama / keyframe)
 *   GET  /health    -> { ok, configured, model, revision, loaded }
 * Optional `Authorization: Bearer <CAST_IMAGE_TOKEN>` on /generate and /unload, matching
 * `SERVICE_TOKEN` in that file. /health is deliberately unauthenticated there, which is what
 * lets the shared door-pool health probe work without a credential.
 *
 * WHY THE MODEL ID IS SENT RATHER THAN LEFT TO THE SIDECAR DEFAULT: before this file
 * `refuseSelfHostModel` had ZERO production callers (ernst's licence read on local#269,
 * section 5 point 5; the same observation is local#398's). Resolving the id here gives the
 * TypeScript half one real call site, so the panel cannot hand a non-allowlisted weight id to a
 * sidecar that has been replaced or is being run by hand. The sidecar still refuses on its own.
 * Two independent refusals, neither standing in for the other.
 */
import {
  DEFAULT_SELF_HOST_HF_MODEL,
  resolveSelfHostModel,
  selfHostRevision,
} from "./cast-image-model-policy.js";
import { base64ToBytes, bytesToBase64 } from "../../utils.js";

/**
 * Matches MAX_REFS in containers/cast-image/app.py. The door silently truncates past this, so
 * sending more would mean the panel believes it sent a reference the model never saw.
 */
export const CAST_IMAGE_MAX_REFS = 4;

/** One Klein 4B image on a 16GB card, cold load included. Generation, not a control call. */
export const CAST_IMAGE_GENERATE_TIMEOUT_MS = 600_000;

/** Unload is control-plane. Bounded for the same reason the Ollama unload is (local#325). */
export const CAST_IMAGE_UNLOAD_TIMEOUT_MS = 15_000;

/**
 * The model label persisted in run state and emitted in `applied`.
 *
 * NOT the Hugging Face repo id. `applied` goes into the render record, and `local/` is the honest
 * statement that the weights ran on this box instead of through Workers AI. The policy module
 * already treats a `local/` prefix as "not an HF id" in looksLikeSelfHostModelId(), so this label
 * can never be mistaken for something to download.
 */
export const LOCAL_CAST_MODEL_TAG = "local/flux-2-klein-4b";

/** True when the state's model label names the on-box door rather than a cloud catalog entry. */
export function isLocalCastModel(model: string): boolean {
  return model === LOCAL_CAST_MODEL_TAG;
}

export function castImageDoorHeaders(token?: string): Record<string, string> {
  const t = token?.trim();
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function fetchRefAsBase64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return bytesToBase64(new Uint8Array(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Collect up to CAST_IMAGE_MAX_REFS reference images as raw base64.
 *
 * A reference that will not fetch is DROPPED, not fatal: the portrait plus whatever source images
 * resolved still produce a usable training image, and a dead `source_urls` entry must not cost the
 * operator the whole cast prep. Exported so a caller can count what it lost.
 */
export async function collectCastRefs(refUrls: string[]): Promise<{ refs: string[]; dropped: number }> {
  const refs: string[] = [];
  let dropped = 0;
  for (const url of refUrls) {
    if (refs.length >= CAST_IMAGE_MAX_REFS) break;
    const b64 = await fetchRefAsBase64(url);
    if (!b64) {
      dropped += 1;
      continue;
    }
    refs.push(b64);
  }
  return { refs, dropped };
}

function mimeOf(raw: unknown): string {
  const s = String(raw || "").trim().toLowerCase();
  return /^image\/(png|jpeg|webp)$/.test(s) ? s : "image/png";
}

async function postJson(
  url: string,
  body: unknown,
  token: string | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { ...castImageDoorHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate ONE training reference on the on-box door.
 *
 * THROWS on every failure, deliberately, and the caller turns that into `ok: false`. cast.image is
 * CAST PREP, not a polish step: the honest soft-degrade shape (ok:true + passthrough + `applied: []`
 * + `degraded`) belongs to speech-upscale and video-finish, where a miss costs quality and the film
 * still assembles (local#249 / local#77). Here a miss means there is no training image, so returning
 * ok:true with nothing generated would report success for an empty training set and the LoRA train
 * step downstream would train on it.
 *
 * It also never falls back to Workers AI. The fall-through would be the exact cloud call this path
 * exists to remove, it needs credentials a homelabber does not have, and ernst's 2026-09-26 read of
 * BFL ToS 1.3(n) on local#269 leaves "may CF FLUX output be trained on" unresolved. Choosing that
 * path silently, inside a failure handler, is not a decision this module gets to make.
 */
export async function generateCastImageLocal(
  doorUrl: string,
  prompt: string,
  refUrls: string[],
  opts: { token?: string; modelId?: string } = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  // Throws on a non-allowlisted id before any network call (local#277 / local#398).
  const modelId = resolveSelfHostModel(opts.modelId ?? DEFAULT_SELF_HOST_HF_MODEL);
  const { refs } = await collectCastRefs(refUrls);

  let r: Response;
  try {
    r = await postJson(
      `${doorUrl}/generate`,
      { prompt, width: 1024, height: 1024, ref_images: refs, model: modelId },
      opts.token,
      CAST_IMAGE_GENERATE_TIMEOUT_MS,
    );
  } catch (e) {
    throw new Error(`cast.image door ${doorUrl} unreachable: ${(e as Error).message}`);
  }

  if (r.status === 503) {
    // The door's own "no CUDA" state. Naming it separately is the difference between an operator
    // fixing their GPU runtime and an operator rebuilding a container that was already correct.
    const detail = await r.text().catch(() => "");
    throw new Error(
      `cast.image door ${doorUrl} has no usable GPU (503). Klein 4B needs about 13GB VRAM; ` +
        `build containers/cast-image on an NVIDIA host and check GET /health reports ` +
        `configured:true. ${detail.slice(0, 200)}`,
    );
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`cast.image door ${doorUrl} /generate -> ${r.status} ${detail.slice(0, 200)}`);
  }

  let payload: { image?: unknown; mime?: unknown; revision?: unknown };
  try {
    payload = (await r.json()) as typeof payload;
  } catch (e) {
    throw new Error(`cast.image door ${doorUrl} returned non-JSON: ${(e as Error).message}`);
  }
  const b64 = typeof payload.image === "string" ? payload.image.trim() : "";
  if (!b64) throw new Error(`cast.image door ${doorUrl} returned no image`);

  // The door reports the revision it actually loaded. A mismatch means the weights on the box are
  // not the ones whose licence was read, which is the whole point of pinning (ernst, point 2).
  const expected = selfHostRevision(modelId);
  const got = typeof payload.revision === "string" ? payload.revision.trim() : "";
  if (got && got !== expected) {
    throw new Error(
      `cast.image door ${doorUrl} loaded ${modelId}@${got}, expected @${expected}. ` +
        "The pinned revision is the one whose licence was verified (THIRD_PARTY_MODELS.md).",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch (e) {
    throw new Error(`cast.image door ${doorUrl} returned undecodable image: ${(e as Error).message}`);
  }
  if (bytes.length === 0) throw new Error(`cast.image door ${doorUrl} returned an empty image`);
  return { bytes, mime: mimeOf(payload.mime) };
}

/** Structured outcome of the post-job VRAM handoff; same three-state shape as OllamaUnloadResult. */
export type CastImageUnloadResult =
  | { status: "unloaded"; door: string }
  | { status: "failed"; door: string; error: string };

/**
 * Hand the card back after the last reference image (local#265 sequencing, cast.image end).
 *
 * BEST EFFORT AND NEVER THROWS: the training images are already stored by the time this runs, so a
 * failed unload must not turn a finished job into a failed one. It is never silent either -- the
 * failure is the operator's only warning that the next keyframe or plan.enhance will contend for
 * VRAM with a pipeline nobody is using.
 */
export async function unloadCastImageDoor(
  doorUrl: string,
  opts: { token?: string } = {},
): Promise<CastImageUnloadResult> {
  try {
    const r = await postJson(`${doorUrl}/unload`, {}, opts.token, CAST_IMAGE_UNLOAD_TIMEOUT_MS);
    if (!r.ok) {
      const error = `/unload -> ${r.status}`;
      console.warn(JSON.stringify({ event: "cast_image_unload", status: "failed", door: doorUrl, error }));
      return { status: "failed", door: doorUrl, error };
    }
    console.info(
      JSON.stringify({
        event: "cast_image_unload",
        status: "unloaded",
        door: doorUrl,
        note: "cast.image job complete; card released",
      }),
    );
    return { status: "unloaded", door: doorUrl };
  } catch (e) {
    const error = e instanceof Error && e.message ? e.message : String(e);
    console.warn(
      JSON.stringify({
        event: "cast_image_unload",
        status: "failed",
        door: doorUrl,
        error: error.slice(0, 200),
      }),
    );
    return { status: "failed", door: doorUrl, error };
  }
}
