// Provider output helpers (ported from vivijure/src/output-extract.ts).

export function detectProviderFailure(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.state === "string" && r.state !== "Completed") {
    return typeof r.error === "string" && r.error.trim()
      ? r.error
      : `provider returned state "${r.state}"`;
  }
  return null;
}

export function extractProxiedImageUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { result?: { image?: unknown }; image?: unknown };
  const wrapped = r.result?.image;
  if (typeof wrapped === "string" && wrapped.length > 0) return wrapped;
  if (typeof r.image === "string" && r.image.length > 0) return r.image;
  return null;
}
