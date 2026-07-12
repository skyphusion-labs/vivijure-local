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
} from "./cast-db.js";
import type { DbEnv } from "./db-env.js";
import { HttpError } from "./errors.js";
import type { FilesystemObjectStore } from "./platform/storage.js";
import { extFromMime } from "./utils.js";

export const CAST_IMAGE_MIME_RE = /^image\/(png|jpe?g|webp)$/i;
export const CAST_MAX_BYTES = 16 * 1024 * 1024;

export interface CastMediaEnv extends DbEnv {
  R2_RENDERS: FilesystemObjectStore;
  R2: FilesystemObjectStore;
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
  const mime = obj.contentType || "image/png";
  if (!CAST_IMAGE_MIME_RE.test(mime)) {
    throw new HttpError(400, `source mime ${mime} not allowed (png/jpeg/webp only)`);
  }
  if (obj.bytes.length > CAST_MAX_BYTES) {
    throw new HttpError(413, "source image too large (16 MB max)");
  }
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
      const row = await setPortrait(env, id, body.key, body.mime);
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    if (!CAST_IMAGE_MIME_RE.test(contentType)) {
      throw new HttpError(
        400,
        `content-type must be image/png, image/jpeg, or image/webp (got ${contentType || "<missing>"})`,
      );
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    if (cur.portrait_key) {
      try {
        await env.R2_RENDERS.delete(cur.portrait_key);
      } catch {
        /* ignore */
      }
    }
    const key = `cast/${id}/portrait.${extFromMime(contentType)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType },
    });
    const row = await setPortrait(env, id, key, contentType);
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
      const row = await addRef(env, id, { key: body.key, mime: body.mime });
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    if (!CAST_IMAGE_MIME_RE.test(contentType)) {
      throw new HttpError(400, "content-type must be image/png, image/jpeg, or image/webp");
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    const key = `cast/${id}/refs/${crypto.randomUUID()}.${extFromMime(contentType)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType },
    });
    const row = await addRef(env, id, { key, mime: contentType });
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
      const row = await addSource(env, id, { key: body.key, mime: body.mime });
      if (!row) throw new HttpError(404, "cast not found");
      return json({ cast: toPublicCast(row) });
    }

    if (!CAST_IMAGE_MIME_RE.test(contentType)) {
      throw new HttpError(400, "content-type must be image/png, image/jpeg, or image/webp");
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) throw new HttpError(400, "empty body");
    if (buf.byteLength > CAST_MAX_BYTES) throw new HttpError(413, "image too large (16 MB max)");
    const key = `cast/${id}/sources/${crypto.randomUUID()}.${extFromMime(contentType)}`;
    await env.R2_RENDERS.put(key, new Uint8Array(buf), {
      httpMetadata: { contentType },
    });
    const row = await addSource(env, id, { key, mime: contentType });
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
