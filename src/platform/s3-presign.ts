// S3-compatible SigV4 query presigning (ported from vivijure/src/r2-presign.ts).
// Works with MinIO, AWS S3, Cloudflare R2, and any SigV4 S3 endpoint.

import { isPresignSafeKey } from "../shared.js";

const ENC = new TextEncoder();
const MAX_EXPIRES_SECONDS = 604800;

function clampExpires(seconds: number): number {
  const n = Math.floor(Number(seconds));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_EXPIRES_SECONDS, Math.max(1, n));
}

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", ENC.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const raw: ArrayBuffer | Uint8Array<ArrayBuffer> =
    key instanceof Uint8Array ? new Uint8Array(key) : key;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, ENC.encode(data));
}

export function uriEncode(str: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of str) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === "/" && !encodeSlash) {
      out += ch;
    } else {
      for (const byte of ENC.encode(ch)) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

export type PresignMethod = "GET" | "PUT";

export interface S3PresignConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region: string;
  /** #54: when false, sign a vhost-style URL (`bucket.host/key`) instead of path-style (`host/bucket/key`).
   *  Defaults to path-style (undefined/true) -- MinIO and R2 accept it; a vhost-style AWS bucket needs false. */
  forcePathStyle?: boolean;
}

export async function presignS3WithConfig(
  cfg: S3PresignConfig,
  method: PresignMethod,
  key: string,
  expiresSeconds = 300,
  nowMs?: number,
): Promise<string> {
  if (!isPresignSafeKey(key)) {
    throw new Error("S3 presign: refusing to sign an unsafe object key");
  }
  expiresSeconds = clampExpires(expiresSeconds);

  const url = new URL(cfg.endpoint);
  // #54: path-style (default) signs over host:endpoint with /bucket/key; vhost signs over host:bucket.endpoint
  // with /key. The signed `host` header and the returned URL host must agree, or the signature is rejected.
  const pathStyle = cfg.forcePathStyle !== false;
  const host = pathStyle ? url.host : `${cfg.bucket}.${url.host}`;
  const region = cfg.region;
  const service = "s3";

  const now = new Date(nowMs ?? Date.now());
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = pathStyle
    ? "/" + uriEncode(cfg.bucket, true) + "/" + uriEncode(key, false)
    : "/" + uriEncode(key, false);

  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(q)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(q[k], true)}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(ENC.encode("AWS4" + cfg.secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const base = pathStyle ? cfg.endpoint.replace(/\/$/, "") : `${url.protocol}//${host}`;
  return `${base}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
