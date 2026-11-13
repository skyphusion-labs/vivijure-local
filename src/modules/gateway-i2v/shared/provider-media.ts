// VENDORED from vivijure-cf (local#568) for the hosted gateway i2v doors. Keep in step:
//   modules/_shared/provider-media.ts and src/capped-body.ts (readCappedBytes), at vivijure-cf main 2451d88.
// A provider media URL is fetched by the module and stored. The read stops at a cap, and the stored
// content type is one this studio will serve.

export class CappedReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CappedReadError";
  }
}

export async function readCappedBytes(
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  fallback: () => Promise<ArrayBuffer>,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CappedReadError(`body too large (Content-Length ${declared} bytes > ${maxBytes} cap)`);
  }
  if (!body || typeof body.getReader !== "function") {
    const buf = new Uint8Array(await fallback());
    if (buf.byteLength > maxBytes) {
      throw new CappedReadError(`body too large (${buf.byteLength} bytes > ${maxBytes} cap)`);
    }
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const value = step.value;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* the caller already has the error */ }
      throw new CappedReadError(`body too large (> ${maxBytes} cap)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export const PROVIDER_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

const EXACT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export function normalizeMediaType(raw: string | null | undefined): string {
  const t = (raw || "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (t === "audio/mp3" || t === "audio/x-mp3") return "audio/mpeg";
  if (t === "audio/wave" || t === "audio/x-wav") return "audio/wav";
  if (t === "audio/x-m4a") return "audio/mp4";
  return t;
}

export function isAllowedMediaType(raw: string | null | undefined): boolean {
  const t = normalizeMediaType(raw);
  if (!t) return false;
  if (EXACT_TYPES.has(t)) return true;
  return /^audio\/[\w.+-]+$/.test(t);
}

function genericType(raw: string): boolean {
  return raw === ""
    || raw === "application/octet-stream"
    || raw === "binary/octet-stream"
    || raw === "text/plain";
}

/** Magic for the media types this studio stores. Unknown bytes return null. */
export function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "video/mp4";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return "audio/wav";
  }
  return null;
}

/** The type to store. A sniffed allowed type wins, then an allowed header, then an allowed fallback
 *  for a missing or generic header. Anything else is refused. */
export function mediaTypeToStore(bytes: Uint8Array, header: string | null | undefined, fallback: string): string {
  const sniffed = sniffMediaType(bytes);
  if (sniffed && isAllowedMediaType(sniffed)) return sniffed;
  const declared = normalizeMediaType(header);
  if (isAllowedMediaType(declared)) return declared;
  const fb = normalizeMediaType(fallback);
  if (genericType(declared) && isAllowedMediaType(fb)) return fb;
  throw new CappedReadError("provider media type is not allowed");
}

export async function readProviderMedia(
  resp: Response,
  opts: { maxBytes: number; fallbackType: string },
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const bytes = await readCappedBytes(resp.headers, resp.body, () => resp.arrayBuffer(), opts.maxBytes);
  const contentType = mediaTypeToStore(bytes, resp.headers.get("content-type"), opts.fallbackType);
  return { bytes, contentType };
}
