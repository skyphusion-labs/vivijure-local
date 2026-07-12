// Shared helpers ported from vivijure/src/shared.ts (dependency-free).

export const BUNDLE_KEY_PREFIX = "bundles/";

const REL_KEY_CHARS = /^[A-Za-z0-9._\-\/]+$/;

export function isSafeRelKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.startsWith("/")) return false;
  if (!REL_KEY_CHARS.test(key)) return false;
  return !key.split("/").includes("..");
}

export function isSafeBundleKey(key: unknown): key is string {
  return isSafeRelKey(key) && key.startsWith(BUNDLE_KEY_PREFIX);
}

export function sanitizeKeySegment(raw: string, fallback = "project"): string {
  const s = raw
    .replace(/[^A-Za-z0-9._\-]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^[._-]+/, "");
  return s.length > 0 ? s : fallback;
}

export function isPresignSafeKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.startsWith("/")) return false;
  if (key.includes("://")) return false;
  if (/[^ -~]/.test(key)) return false;
  return !key.split("/").includes("..");
}

export type ByteRange = { offset: number; length: number; start: number; end: number };

export function parseByteRange(
  header: string | null | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(.*)$/.exec(header.trim());
  if (!m) return null;
  const specs = m[1].split(",");
  if (specs.length !== 1) return null;
  const spec = specs[0].trim();
  const dash = spec.indexOf("-");
  if (dash === -1) return null;
  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();
  const digits = /^[0-9]*$/;
  if (!digits.test(startStr) || !digits.test(endStr)) return null;

  if (size <= 0) return "unsatisfiable";

  if (startStr === "") {
    if (endStr === "") return null;
    const n = Number(endStr);
    if (n === 0) return "unsatisfiable";
    const start = n >= size ? 0 : size - n;
    const end = size - 1;
    return { offset: start, length: end - start + 1, start, end };
  }

  const start = Number(startStr);
  if (start >= size) return "unsatisfiable";
  if (endStr === "") {
    const end = size - 1;
    return { offset: start, length: end - start + 1, start, end };
  }
  let end = Number(endStr);
  if (end < start) return null;
  if (end >= size) end = size - 1;
  return { offset: start, length: end - start + 1, start, end };
}
