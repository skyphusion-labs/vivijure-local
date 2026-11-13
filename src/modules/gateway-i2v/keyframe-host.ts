// local#568 (lead ruling): a hosted i2v provider FETCHES the keyframe by URL over the internet. On a
// box without the edge profile the presigned URL is loopback (PUBLIC_BASE_URL=http://127.0.0.1:8790)
// or a LAN address, the provider cannot reach it, and the paid call fails at the provider. Refuse
// before any spend instead, and name the fix. local#575 applies the same check to the RunPod cloud doors.
import { isIP } from "node:net";

export const KEYFRAME_NOT_PUBLIC_HINT =
  "set S3_PRESIGN_ENDPOINT to a public HTTPS URL for object storage (see docs/EDGE.md)";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function privateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  // IPv4-mapped: WHATWG URL rewrites [::ffff:192.168.1.1] to the hex form ::ffff:c0a8:101.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) return privateV4(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80");
}

/** Why a provider cannot fetch this URL, or null when its host is public. Judged on the host only:
 *  a name that resolves privately is not caught (no DNS lookup before a refusal), only the forms
 *  that are private on their face (loopback, RFC1918, link-local, CGNAT, ULA, localhost, .local). */
export function keyframeHostRefusal(rawUrl: string | undefined, what = "keyframe"): string | null {
  if (!rawUrl) return null;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return `the ${what} URL is not a valid URL`;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const kind = isIP(host);
  const isPrivate =
    kind === 4 ? privateV4(host)
    : kind === 6 ? privateV6(host)
    : host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
  return isPrivate ? `the ${what} URL host "${host}" is not reachable from the internet` : null;
}

/** local#575: every http(s) URL a request body hands a provider to FETCH (the keyframe, the end
 *  keyframe, driving audio), checked the same way. The field name is used to say which one. Returns
 *  the first refusal, or null. Walks nested objects and arrays; a data: URI is not a fetch. */
export function bodyUrlRefusal(body: unknown, field = "input"): string | null {
  if (typeof body === "string") {
    return /^https?:\/\//i.test(body) ? keyframeHostRefusal(body, field) : null;
  }
  if (Array.isArray(body)) {
    for (const v of body) {
      const r = bodyUrlRefusal(v, field);
      if (r) return r;
    }
    return null;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      const r = bodyUrlRefusal(v, k);
      if (r) return r;
    }
  }
  return null;
}
