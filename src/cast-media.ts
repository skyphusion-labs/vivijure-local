// Cast portrait / ref / source uploads (ported from vivijure/src/cast-media.ts).

import {
  addRef,
  addSource,
  clearPortrait,
  getCastById,
  removeRef,
  removeSource,
  setPortrait,
  toPublicCast,
  type CastMember,
} from "@skyphusion-labs/vivijure-core/cast-db";
import type { DbEnv } from "@skyphusion-labs/vivijure-core/db-env";
import { HttpError } from "./errors.js";
import type { ArtifactStore } from "./platform/create-storage.js";
import { extFromMime } from "./utils.js";

export const CAST_IMAGE_MIME_RE = /^image\/(png|jpe?g|webp)$/i;
export const CAST_MAX_BYTES = 16 * 1024 * 1024;

/** Strict magic-byte sniff for cast images. Returns null when bytes are not png/jpeg/webp
 *  (unlike module image-gen sniffers that default to image/png -- a default would launder HTML). */
export function sniffCastImageMime(bytes: ArrayBuffer | Uint8Array): string | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Allowlist + optional content sniff for cast portrait/ref/source MIME.
 *  Rejects text/html and other non-image types (stored-XSS when /api/artifact serves the object).
 *  When bytes are provided, magic must match the claimed type. Throws Error with a safe message. */
export function resolveCastImageMime(claimed: string, bytes?: ArrayBuffer | Uint8Array): string {
  const raw = (claimed || "").toLowerCase().split(";")[0].trim();
  if (!CAST_IMAGE_MIME_RE.test(raw)) {
    throw new Error(`mime ${raw || "<missing>"} not allowed (png/jpeg/webp only)`);
  }
  const mime = raw === "image/jpg" ? "image/jpeg" : raw;
  if (bytes !== undefined) {
    const sniffed = sniffCastImageMime(bytes);
    if (!sniffed) {
      throw new Error("bytes are not a recognizable png/jpeg/webp image");
    }
    if (sniffed !== mime) {
      throw new Error(`claimed mime ${mime} does not match content (${sniffed})`);
    }
  }
  return mime;
}

function requireCastImageMime(claimed: string, bytes?: ArrayBuffer | Uint8Array): string {
  try {
    return resolveCastImageMime(claimed, bytes);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

export interface CastMediaEnv extends DbEnv {
  R2_RENDERS: ArtifactStore;
  R2: ArtifactStore;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function wrap(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e) => {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  });
}

export async function copyChatArtifactToRenders(
  env: CastMediaEnv,
  srcKey: string,
  destPrefix: string,
): Promise<{ key: string; mime: string }> {
  const obj = await env.R2.getBytes(srcKey);
  if (!obj) throw new HttpError(404, `source artifact not found: ${srcKey}`);
  if (obj.bytes.length > CAST_MAX_BYTES) {
    throw new HttpError(413, "source image too large (16 MB max)");
  }
  const mime = requireCastImageMime(obj.contentType || "", obj.bytes);
  const key = `${destPrefix}.${extFromMime(mime)}`;
  await env.R2_RENDERS.put(key, obj.bytes, { httpMetadata: { contentType: mime } });
  return { key, mime };
}

export async function handleCastPortraitUpload(
  request: Request,
  env: CastMediaEnv,
  id: number,
): Promise<Response> {
  return wrap(async () => {
    const cur = await getCastById(env, id);
    if (!cur) throw new HttpError(404, "cast not found");

    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("application/json")) {
      let body: { key?: string; mime?: string; from_chat_artifact?: unknown };
      try {
        body = (await request.json()) as {
          key?: string;
          mime?: string;
          from_chat_artifact?: unknown;
        };
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }

      if (typeof body.from_chat_artifact === "string" && body.from_chat_artifact) {
        if (cur.portrait_key) {
          try {
            await env.R2_RENDERS.delete(cur.portrait_key);
          } catch {
            /* ignore */
          }
        }
        const { key, mime } = await copyChatArtifactToRenders(
          env,
          body.from_chat_artifact,
          `cast/${id}/portrait`,
        );
        const row = await setPortrait(env, id, key, mime);
        return json({ cast: row ? toPublicCast(row) : null });
      }

      if (!body.key || !body.mime) throw new HttpError(400, "key and mime required");
      const mime = requireCastImageMime(body.mime);
      const row = await setPortrait(env, id, body.key, mime);
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    const mime = requireCastImageMime(contentType, buf);
    if (cur.portrait_key) {
      try {
        await env.R2_RENDERS.delete(cur.portrait_key);
      } catch {
        /* ignore */
      }
    }
    const key = `cast/${id}/portrait.${extFromMime(mime)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType: mime },
    });
    const row = await setPortrait(env, id, key, mime);
    return json({ cast: row ? toPublicCast(row) : null });
  });
}

export async function handleCastRefAdd(
  request: Request,
  env: CastMediaEnv,
  id: number,
): Promise<Response> {
  return wrap(async () => {
    const cur = await getCastById(env, id);
    if (!cur) throw new HttpError(404, "cast not found");

    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("application/json")) {
      let body: { key?: string; mime?: string; from_chat_artifact?: unknown };
      try {
        body = (await request.json()) as {
          key?: string;
          mime?: string;
          from_chat_artifact?: unknown;
        };
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }

      if (typeof body.from_chat_artifact === "string" && body.from_chat_artifact) {
        const { key, mime } = await copyChatArtifactToRenders(
          env,
          body.from_chat_artifact,
          `cast/${id}/refs/${crypto.randomUUID()}`,
        );
        const row = await addRef(env, id, { key, mime });
        return json({ cast: row ? toPublicCast(row) : null });
      }

      if (!body.key || !body.mime) throw new HttpError(400, "key and mime required");
      const mime = requireCastImageMime(body.mime);
      const row = await addRef(env, id, { key: body.key, mime });
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    const mime = requireCastImageMime(contentType, buf);
    const key = `cast/${id}/refs/${crypto.randomUUID()}.${extFromMime(mime)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType: mime },
    });
    const row = await addRef(env, id, { key, mime });
    return json({ cast: row ? toPublicCast(row) : null });
  });
}

export async function handleCastRefRemove(
  env: CastMediaEnv,
  id: number,
  refKey: string,
): Promise<Response> {
  const result = await removeRef(env, id, refKey);
  if (!result.row) return json({ error: "cast not found" }, 404);
  if (!result.removedKey) return json({ error: "ref key not in this cast member's set" }, 404);
  try {
    await env.R2_RENDERS.delete(result.removedKey);
  } catch {
    /* ignore */
  }
  return json({ cast: toPublicCast(result.row) });
}

export async function handleCastSourceAdd(
  request: Request,
  env: CastMediaEnv,
  id: number,
): Promise<Response> {
  return wrap(async () => {
    const cur = await getCastById(env, id);
    if (!cur) throw new HttpError(404, "cast not found");

    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("application/json")) {
      let body: { key?: string; mime?: string; from_chat_artifact?: unknown };
      try {
        body = (await request.json()) as {
          key?: string;
          mime?: string;
          from_chat_artifact?: unknown;
        };
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }

      if (typeof body.from_chat_artifact === "string" && body.from_chat_artifact) {
        const { key, mime } = await copyChatArtifactToRenders(
          env,
          body.from_chat_artifact,
          `cast/${id}/sources/${crypto.randomUUID()}`,
        );
        const row = await addSource(env, id, { key, mime });
        return json({ cast: row ? toPublicCast(row) : null });
      }

      if (!body.key || !body.mime) throw new HttpError(400, "key and mime required");
      const mime = requireCastImageMime(body.mime);
      const row = await addSource(env, id, { key: body.key, mime });
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    const mime = requireCastImageMime(contentType, buf);
    const key = `cast/${id}/sources/${crypto.randomUUID()}.${extFromMime(mime)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType: mime },
    });
    const row = await addSource(env, id, { key, mime });
    return json({ cast: row ? toPublicCast(row) : null });
  });
}

export async function handleCastSourceRemove(
  env: CastMediaEnv,
  id: number,
  srcKey: string,
): Promise<Response> {
  const result = await removeSource(env, id, srcKey);
  if (!result.row) return json({ error: "cast not found" }, 404);
  if (!result.removedKey) return json({ error: "source key not in this cast member's set" }, 404);
  try {
    await env.R2_RENDERS.delete(result.removedKey);
  } catch {
    /* ignore */
  }
  return json({ cast: toPublicCast(result.row) });
}

export async function deleteCastArtifacts(env: CastMediaEnv, cast: CastMember): Promise<void> {
  const keys = [
    cast.portrait_key,
    ...cast.ref_keys.map((r) => r.key),
    ...cast.source_keys.map((s) => s.key),
    cast.lora_key,
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
  for (const key of keys) {
    try {
      await env.R2_RENDERS.delete(key);
    } catch {
      /* ignore */
    }
  }
}

export type { CastMember };
