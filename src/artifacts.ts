// Artifact upload + byte-range serve (ported from vivijure/src/index.ts).

import { notFound, badRequest } from "./errors.js";
import { isSafeRelKey, parseByteRange } from "./shared.js";
import type { FilesystemObjectStore } from "./platform/storage.js";

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
  "loras/",
  "out/",
  "renders/",
  "uploads/",
];

function artifactHeaders(contentType: string): Headers {
  const h = new Headers();
  h.set("content-type", contentType || "application/octet-stream");
  h.set("cache-control", "private, max-age=300");
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");
  return h;
}

function assertArtifactKey(key: string): void {
  if (!key || !isSafeRelKey(key) || !ARTIFACT_PREFIXES.some((pre) => key.startsWith(pre))) {
    throw notFound("artifact");
  }
}

export async function handleUpload(req: Request, store: FilesystemObjectStore): Promise<Response> {
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

export async function handleServeArtifact(req: Request, store: FilesystemObjectStore, rawKey: string): Promise<Response> {
  const key = decodeURIComponent(rawKey);
  assertArtifactKey(key);

  const isHead = req.method === "HEAD";
  const rangeHeader = req.headers.get("range");

  if (isHead || rangeHeader) {
    const meta = await store.head(key);
    if (!meta) throw notFound("artifact");
    const ct = meta.httpMetadata?.contentType || "application/octet-stream";
    const parsed = parseByteRange(rangeHeader, meta.size);

    if (parsed === "unsatisfiable") {
      const h = artifactHeaders(ct);
      h.set("content-range", `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers: h });
    }
    if (parsed) {
      const h = artifactHeaders(ct);
      h.set("content-range", `bytes ${parsed.start}-${parsed.end}/${meta.size}`);
      h.set("content-length", String(parsed.length));
      if (isHead) return new Response(null, { status: 206, headers: h });
      const slice = await store.getRange(key, parsed.offset, parsed.length);
      if (!slice) throw notFound("artifact");
      return new Response(slice, { status: 206, headers: h });
    }
    const h = artifactHeaders(ct);
    h.set("content-length", String(meta.size));
    if (isHead) return new Response(null, { status: 200, headers: h });
    const full = await store.getBytes(key);
    if (!full) throw notFound("artifact");
    return new Response(full.bytes, { status: 200, headers: h });
  }

  const obj = await store.getBytes(key);
  if (!obj) throw notFound("artifact");
  const h = artifactHeaders(obj.contentType);
  h.set("content-length", String(obj.size));
  return new Response(obj.bytes, { headers: h });
}

/** Extract artifact key from /api/artifact/<key...> pathname. */
export function artifactKeyFromPath(pathname: string): string {
  const prefix = "/api/artifact/";
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length);
}
