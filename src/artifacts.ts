// Artifact upload + byte-range serve (ported from vivijure/src/index.ts).

import { notFound, badRequest, serviceUnavailable } from "./errors.js";
import { isSafeRelKey, parseByteRange, safeDecodeUriComponent } from "./shared.js";
import type { ArtifactStore } from "./platform/create-storage.js";
import type { ObjectPresigner } from "./platform/types.js";

export const UPLOAD_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ARTIFACT_PREFIXES = [
  "audio/",
  "bundles/",
  "cast/",
  "cast-clean/",
  "cast-gen/",
  "character-refs/",
  "characters/",
  "clips/",
  // Isolated public-demo prefix (AUTH_MODE=demo gate allows only demo/ + renders/demo/).
  "demo/",
  "loras/",
  "out/",
  "renders/",
  "uploads/",
];

const ARTIFACT_SAFE_CT_RE =
  /^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|application\/(octet-stream|json|x-tar|zip|safetensors))$/i;

function safeArtifactContentType(contentType: string): string {
  const t = (contentType || "").split(";")[0].trim();
  if (ARTIFACT_SAFE_CT_RE.test(t)) return t === "image/jpg" ? "image/jpeg" : t;
  return "application/octet-stream";
}

function artifactHeaders(contentType: string, key?: string): Headers {
  const h = new Headers();
  h.set("content-type", safeArtifactContentType(contentType));
  h.set("cache-control", "private, max-age=300");
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");
  const base = (key || "artifact").split("/").pop() || "artifact";
  const safeName = base.replace(/[^\w.\-]+/g, "_").slice(0, 180) || "artifact";
  h.set("content-disposition", `attachment; filename="${safeName}"`);
  return h;
}

function assertArtifactKey(key: string): void {
  if (!key || !isSafeRelKey(key) || !ARTIFACT_PREFIXES.some((pre) => key.startsWith(pre))) {
    throw notFound("artifact");
  }
}

export async function handleUpload(req: Request, store: ArtifactStore): Promise<Response> {
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim() || "application/octet-stream";
  const ext = UPLOAD_EXT[mime];
  if (!ext) throw badRequest(`unsupported content-type ${mime || "<missing>"} (png/jpeg/webp/gif only)`);
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw badRequest("empty upload body");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest("upload too large (max 25MB)");
  const key = `uploads/${crypto.randomUUID()}.${ext}`;
  await store.put(key, bytes, { httpMetadata: { contentType: mime } });
  return new Response(JSON.stringify({ key, mime, bytes: bytes.byteLength }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleServeArtifact(req: Request, store: ArtifactStore, rawKey: string): Promise<Response> {
  const key = safeDecodeUriComponent(rawKey);
  if (key === null) throw badRequest("invalid artifact key encoding");
  assertArtifactKey(key);

  const isHead = req.method === "HEAD";
  const rangeHeader = req.headers.get("range");

  if (isHead || rangeHeader) {
    const meta = await store.head(key);
    if (!meta) throw notFound("artifact");
    const ct = meta.httpMetadata?.contentType || "application/octet-stream";
    const parsed = parseByteRange(rangeHeader, meta.size);

    if (parsed === "unsatisfiable") {
      const h = artifactHeaders(ct, key);
      h.set("content-range", `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers: h });
    }
    if (parsed) {
      const h = artifactHeaders(ct, key);
      h.set("content-range", `bytes ${parsed.start}-${parsed.end}/${meta.size}`);
      h.set("content-length", String(parsed.length));
      if (isHead) return new Response(null, { status: 206, headers: h });
      const slice = await store.getRange(key, parsed.offset, parsed.length);
      if (!slice) throw notFound("artifact");
      return new Response(slice, { status: 206, headers: h });
    }
    const h = artifactHeaders(ct, key);
    h.set("content-length", String(meta.size));
    if (isHead) return new Response(null, { status: 200, headers: h });
    const full = await store.getBytes(key);
    if (!full) throw notFound("artifact");
    return new Response(full.bytes, { status: 200, headers: h });
  }

  const obj = await store.getBytes(key);
  if (!obj) throw notFound("artifact");
  const h = artifactHeaders(obj.contentType, key);
  h.set("content-length", String(obj.size));
  return new Response(obj.bytes, { headers: h });
}

/** Extract artifact key from /api/artifact/<key...> pathname. */
export function artifactKeyFromPath(pathname: string): string {
  const prefix = "/api/artifact/";
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length);
}

// local#309 (cf#317 twin): GET /api/artifact-url/<key> -- turn an artifact KEY into a fetchable URL,
// so a caller that cannot carry bytes (an MCP proxy, a chat client) can still reach the object.
//
// A presigned URL is a capability credential, so the two properties that matter are SCOPE (never a
// prefix or wildcard, only the one key asked for) and EXPIRY (the caller cannot widen it past the
// ceiling). Both are enforced here exactly as vivijure-cf's twin route enforces them: the key runs
// through the SAME guard the serve route uses (assertArtifactKey), existence is checked BEFORE
// presigning (a 200 must always name a real object, never a signed URL that 404s later), and the TTL
// is clamped server-side so a requested value never reaches the presigner unclamped.
//
// The filesystem backend cannot honor either guarantee (see LocalObjectPresigner.presignGet), so it
// refuses by throwing; that refusal is translated into an honest 503 here rather than a 500, carrying
// the presigner's own actionable message. Never a token-bearing or non-expiring URL.
export const ARTIFACT_URL_MIN_TTL = 60;
export const ARTIFACT_URL_MAX_TTL = 3600;
export const ARTIFACT_URL_DEFAULT_TTL = 300;

/** Clamp a caller-supplied lifetime into the allowed band. Absent/blank/garbage -> the default;
 *  never throws, because a bad TTL is not worth failing a read over -- it is worth ignoring. */
export function clampArtifactUrlTtl(raw: string | null): number {
  if (raw === null || raw.trim() === "") return ARTIFACT_URL_DEFAULT_TTL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return ARTIFACT_URL_DEFAULT_TTL;
  return Math.min(ARTIFACT_URL_MAX_TTL, Math.max(ARTIFACT_URL_MIN_TTL, Math.floor(n)));
}

export async function handleArtifactUrl(
  req: Request,
  store: ArtifactStore,
  presigner: ObjectPresigner,
  rawKey: string,
): Promise<Response> {
  const key = safeDecodeUriComponent(rawKey);
  if (key === null) throw badRequest("invalid artifact key encoding");
  assertArtifactKey(key);

  // Existence + real metadata BEFORE presigning, same as the serve route: a 200 always names a real
  // object, never a signed URL that 404s later against the store.
  const meta = await store.head(key);
  if (!meta) throw notFound("artifact");

  const expiresIn = clampArtifactUrlTtl(new URL(req.url).searchParams.get("expires_in"));

  let url: string;
  try {
    url = await presigner.presignGet(key, expiresIn);
  } catch (e) {
    // The presigner refused rather than hand back a token-bearing or non-expiring URL -- that IS the
    // correct behavior on a backend that cannot honor both guarantees (local#309), so it surfaces as
    // an honest 503 with the presigner's own actionable message, never a 500.
    const message = e instanceof Error ? e.message : "this backend cannot mint a scoped, expiring artifact URL";
    throw serviceUnavailable(message);
  }

  return new Response(
    JSON.stringify({
      key,
      url,
      expires_in: expiresIn,
      content_type: meta.httpMetadata?.contentType || "application/octet-stream",
      size: meta.size,
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/** Extract artifact key from /api/artifact-url/<key...> pathname. */
export function artifactUrlKeyFromPath(pathname: string): string {
  const prefix = "/api/artifact-url/";
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length);
}
