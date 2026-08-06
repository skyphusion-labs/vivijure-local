/**
 * cast.image model licensing policy (local#277).
 *
 * FLUX.2 klein-9B and flux-2-dev weights are FLUX Non-Commercial on Hugging Face.
 * Commercial use of those weights is lawful ONLY through Cloudflare's BFL partner
 * channel (`@cf/black-forest-labs/...`). Self-hosting them is a license violation.
 *
 * FLUX.2 Klein 4B is Apache-2.0 and ungated: the only FLUX family member this door
 * may self-host. See THIRD_PARTY_MODELS.md and USE.md.
 *
 * This module is the code half of that constraint. Documentation alone is not a
 * guardrail (local#269 read as a bug against the CF default until this was written).
 */

/** HF repo ids that are lawful to self-host (Apache-2.0 / commercially unrestricted). */
export const SELF_HOST_ALLOWED_HF_MODELS = [
  "black-forest-labs/FLUX.2-klein-4B",
] as const;

export type SelfHostAllowedHfModel = (typeof SELF_HOST_ALLOWED_HF_MODELS)[number];

/**
 * Default HF id for a local cast.image sidecar (Apache-2.0 Klein 4B).
 * Sidecars must refuse anything outside SELF_HOST_ALLOWED_HF_MODELS.
 */
export const DEFAULT_SELF_HOST_HF_MODEL: SelfHostAllowedHfModel =
  "black-forest-labs/FLUX.2-klein-4B";

/**
 * Full cloud cast.image catalog (order = panel enum order). Default is klein-9b via CF
 * BFL partner channel -- lawful commercial inference, NOT a self-host of non-commercial
 * weights. Do not "fix" this default to a HF id. `@cf/` entries may name non-commercial
 * weight families because the weights never land on the box; inference is licensed through
 * Cloudflare. `google/nano-banana-pro` is a provider overlay (provider terms, no HF weights).
 */
export const CLOUD_CAST_MODELS = [
  "@cf/black-forest-labs/flux-2-klein-9b",
  "google/nano-banana-pro",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-dev",
] as const;

export type CloudCastModel = (typeof CLOUD_CAST_MODELS)[number];

/** Default cloud cast.image model: CF BFL channel (lawful commercial inference). */
export const DEFAULT_CLOUD_CAST_MODEL: CloudCastModel =
  "@cf/black-forest-labs/flux-2-klein-9b";

const SELF_HOST_SET = new Set<string>(SELF_HOST_ALLOWED_HF_MODELS);

/**
 * True when `id` is a Hugging Face-style repo id (not `@cf/` and not `google/` etc.).
 * Those paths would download weights onto the box.
 */
export function looksLikeSelfHostModelId(id: string): boolean {
  const s = id.trim();
  if (!s) return false;
  if (s.startsWith("@cf/")) return false;
  if (s.startsWith("google/") || s.startsWith("openai/") || s.startsWith("local/")) return false;
  // org/name HF form
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
}

/**
 * Allowlist check for a self-host / sidecar model id (env CAST_IMAGE_MODEL or request payload).
 * Returns null when allowed; otherwise a refusal message suitable for logs and HTTP 400/403.
 */
export function refuseSelfHostModel(id: string | undefined | null): string | null {
  const raw = String(id ?? "").trim();
  if (!raw) {
    return (
      "cast.image self-host: empty model id refused; " +
      `permitted Apache-only: ${SELF_HOST_ALLOWED_HF_MODELS.join(", ")}`
    );
  }
  if (SELF_HOST_SET.has(raw)) return null;
  // Explicit refusal for the known non-commercial siblings so the message is diagnostic.
  const lower = raw.toLowerCase();
  if (
    lower.includes("flux-2-klein-9b") ||
    lower.includes("flux.2-klein-9b") ||
    lower.includes("flux-2-dev") ||
    lower.includes("flux.2-dev")
  ) {
    return (
      `cast.image self-host: ${raw} carries the FLUX Non-Commercial License and must not be ` +
      "self-hosted. Commercial use is lawful only via Cloudflare Workers AI (@cf/black-forest-labs/...). " +
      `Apache-only allowlist: ${SELF_HOST_ALLOWED_HF_MODELS.join(", ")}. See THIRD_PARTY_MODELS.md.`
    );
  }
  return (
    `cast.image self-host: ${raw} is not on the Apache-only allowlist; ` +
    `permitted: ${SELF_HOST_ALLOWED_HF_MODELS.join(", ")}. See THIRD_PARTY_MODELS.md (local#277).`
  );
}

/** Resolve env/request model for a local sidecar: default Klein 4B, refuse anything else. */
export function resolveSelfHostModel(id?: string | null): SelfHostAllowedHfModel {
  const raw = String(id ?? "").trim();
  if (!raw) return DEFAULT_SELF_HOST_HF_MODEL;
  const refusal = refuseSelfHostModel(raw);
  if (refusal) throw new Error(refusal);
  return raw as SelfHostAllowedHfModel;
}

/** True when a cloud catalog model id is one of the allowed CF/overlay entries. */
export function isCloudCastModel(id: string): id is CloudCastModel {
  return (CLOUD_CAST_MODELS as readonly string[]).includes(id);
}
