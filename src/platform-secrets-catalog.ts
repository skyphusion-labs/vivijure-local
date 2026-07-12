// Declarative catalog of operator-editable platform secrets / connection fields.
// The Settings GUI projects this list; nothing is hardcoded in the HTML.
//
// GUI-editable: provider / infra keys that bill per use (S3/R2, AI Gateway, Anthropic, RunPod, …).
// Install-only: STUDIO_API_TOKEN (studio login; gates every /api call). Install seeds it into
// platform_secrets before the UI is reachable; Settings must not expose or rotate it.

export type SecretCategory = "storage" | "ai" | "providers" | "modules" | "media";

export type SecretAppliesOn = "immediate" | "restart";

export interface PlatformSecretField {
  key: string;
  label: string;
  blurb: string;
  category: SecretCategory;
  /** Render as password input; API never returns the raw value after save. */
  sensitive: boolean;
  /** How soon a saved value takes effect without restarting the Node process. */
  applies_on: SecretAppliesOn;
}

export const PLATFORM_SECRET_CATEGORIES: { id: SecretCategory; label: string; blurb: string }[] = [
  {
    id: "storage",
    label: "Object storage",
    blurb: "Where renders, bundles, and clips are stored (MinIO, S3, or R2).",
  },
  {
    id: "ai",
    label: "AI planning",
    blurb: "Cloudflare AI Gateway (recommended) or a direct Anthropic key for storyboard planning.",
  },
  {
    id: "providers",
    label: "GPU cloud",
    blurb: "RunPod credentials when you bind RunPod-backed motion or finish modules.",
  },
  {
    id: "modules",
    label: "Render modules",
    blurb: "HTTP URLs for bound GPU / cloud module sidecars (set when not using docker compose defaults).",
  },
  {
    id: "media",
    label: "Media CPU services",
    blurb: "Video finish, image prep, and audio stack sidecars (compose wires these by default).",
  },
];

/** Keys the GUI may read/write. Env vars with the same name are fallbacks when no DB row exists. */
export const PLATFORM_SECRET_FIELDS: PlatformSecretField[] = [
  {
    key: "S3_ENDPOINT",
    label: "Storage endpoint",
    blurb: "S3-compatible URL (MinIO on homelab, or https://<account>.r2.cloudflarestorage.com).",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_ACCESS_KEY_ID",
    label: "Storage access key",
    blurb: "Access key ID for the renders bucket.",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    label: "Storage secret key",
    blurb: "Secret access key for the renders bucket.",
    category: "storage",
    sensitive: true,
    applies_on: "restart",
  },
  {
    key: "S3_BUCKET",
    label: "Renders bucket",
    blurb: "Bucket name for film jobs, clips, and bundles.",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_REGION",
    label: "Storage region",
    blurb: "Region slug (use auto for Cloudflare R2).",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_PRESIGN_ENDPOINT",
    label: "Presign endpoint (optional)",
    blurb: "Reachable host for presigned URLs when the studio runs in Docker but GPUs fetch from the LAN.",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "CLOUDFLARE_ACCOUNT_ID",
    label: "Cloudflare account ID",
    blurb: "For AI Gateway unified billing (planner storyboard AI).",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "GATEWAY_ID",
    label: "AI Gateway ID",
    blurb: "Gateway slug on your Cloudflare account (often vivijure).",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "CF_AIG_TOKEN",
    label: "AI Gateway token",
    blurb: "cf-aig-authorization token for unified billing.",
    category: "ai",
    sensitive: true,
    applies_on: "immediate",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key (BYOK fallback)",
    blurb: "Direct provider key when AI Gateway is not configured.",
    category: "ai",
    sensitive: true,
    applies_on: "immediate",
  },
  {
    key: "RUNPOD_API_KEY",
    label: "RunPod API key",
    blurb: "Scoped RunPod key for cloud GPU modules (motion, finish satellites).",
    category: "providers",
    sensitive: true,
    applies_on: "immediate",
  },
  {
    key: "RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (default backend)",
    blurb: "Default serverless endpoint for keyframe / i2v modules (upstream: BACKEND_RUNPOD_ENDPOINT_ID).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "PLANNER_AI_MOCK",
    label: "Offline planner mock",
    blurb: "Set true to run storyboard planning without cloud AI (homelab offline dev).",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_KEYFRAME_URL",
    label: "Keyframe module URL",
    blurb: "HTTP base URL for MODULE_KEYFRAME sidecar.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_LOCAL_GPU_URL",
    label: "Local GPU module URL",
    blurb: "HTTP base URL for the homelab GPU motion module.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_CLOUD_KEYFRAME_URL",
    label: "Cloud keyframe module URL",
    blurb: "Optional cloud keyframe worker URL.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_OWN_GPU_URL",
    label: "Own GPU module URL",
    blurb: "Optional RunPod-backed GPU module URL.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_RUNPOD_I2V_URL",
    label: "RunPod i2v module URL",
    blurb: "Optional cloud motion backend URL.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "VIDEO_FINISH_URL",
    label: "Video finish service",
    blurb: "CPU container for concat / finish / inspect.",
    category: "media",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "IMAGE_PREP_URL",
    label: "Image prep service",
    blurb: "CPU container for portrait background removal.",
    category: "media",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "AUDIO_BEAT_SYNC_URL",
    label: "Beat sync service",
    blurb: "CPU container for audio beat analysis.",
    category: "media",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "AUDIO_MIX_URL",
    label: "Audio mix service",
    blurb: "CPU container for dialogue / bed mux.",
    category: "media",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "AUDIO_MASTER_URL",
    label: "Audio master service",
    blurb: "CPU container for loudness mastering.",
    category: "media",
    sensitive: false,
    applies_on: "immediate",
  },
];

/** Install/bootstrap keys: never writable from the Settings GUI (install script / compose only). */
export const PLATFORM_SECRET_INSTALL_ONLY = new Set(["STUDIO_API_TOKEN", "DATABASE_PATH", "PORT"]);

export function platformSecretField(key: string): PlatformSecretField | undefined {
  return PLATFORM_SECRET_FIELDS.find((f) => f.key === key);
}
