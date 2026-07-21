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
    blurb: "Reachable host for presigned URLs when GPUs/RunPod fetch off-box (public MinIO HTTPS URL).",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_FETCH_ALLOW_HOSTS",
    label: "CPU fetch allowlist hosts",
    blurb: "Comma-separated hosts for presigned URL SSRF guard on CPU containers (include public MinIO hostname).",
    category: "storage",
    sensitive: false,
    applies_on: "restart",
  },
  {
    key: "S3_ALLOW_HTTP_FETCH",
    label: "Allow HTTP presigned fetches",
    blurb: "Set false when S3_PRESIGN_ENDPOINT uses HTTPS (Caddy edge MinIO).",
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
    blurb: "Default serverless endpoint when per-module overrides are unset (upstream: BACKEND_RUNPOD_ENDPOINT_ID).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "BACKEND_RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (Wan i2v / own-gpu)",
    blurb: "vivijure-backend endpoint for own-gpu and finish-rife; use when keyframe SDXL runs on a separate endpoint.",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "KEYFRAME_RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (SDXL keyframe)",
    blurb: "Optional keyframe-only endpoint when SDXL preview runs separately from the Wan i2v backend.",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (video upscale)",
    blurb: "finish-upscale satellite (vivijure-upscale).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MUSETALK_RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (MuseTalk)",
    blurb: "finish-lipsync satellite (vivijure-musetalk).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID",
    label: "RunPod endpoint ID (audio upscale)",
    blurb: "speech-upscale satellite (vivijure-audio-upscale).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "RUNPOD_WAN_TRAIN_ENDPOINT_ID",
    label: "RunPod endpoint ID (Wan cast LoRA train, local only)",
    blurb:
      "Dedicated local Wan train EP (cf#29). Must point at a RunPod endpoint whose template R2_* " +
      "targets this studio's MinIO, NOT prod CF R2. Value from fleet-chezmoi CR-2026-07-21-vivijure-wan-train-local-ep " +
      "after approved apply. Never set prod zqb7tougbqfkqa here. Fail-closed when unset.",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_BACKEND_URL",
    label: "Local GPU backend URL",
    blurb: "Base URL for the homelab vivijure-local-backend (local-gpu module proxies here).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_BACKEND_TOKEN",
    label: "Local GPU backend token",
    blurb: "Optional bearer token for LOCAL_BACKEND_URL (defense in depth on public GPU backends).",
    category: "providers",
    sensitive: true,
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
    blurb: "RunPod-backed own-gpu motion module sidecar URL.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_FINISH_RIFE_URL",
    label: "finish-rife module URL",
    blurb: "RIFE interpolation finish module sidecar.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_LIPSYNC_URL",
    label: "finish-lipsync module URL",
    blurb: "Lipsync finish module sidecar (upstream MODULE_LIPSYNC).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_UPSCALE_URL",
    label: "finish-upscale module URL",
    blurb: "Upscale finish module sidecar (upstream MODULE_UPSCALE).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_SEEDANCE_URL",
    label: "Seedance module URL",
    blurb: "Cloud motion backend (Seedance i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_KLING_URL",
    label: "Kling module URL",
    blurb: "Cloud motion backend (Kling i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_GOOGLE_VEO_URL",
    label: "Google Veo module URL",
    blurb: "Cloud motion backend (Veo i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_MINIMAX_HAILUO_URL",
    label: "MiniMax Hailuo module URL",
    blurb: "Cloud motion backend (Hailuo i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_VIDU_Q3_URL",
    label: "Vidu Q3 module URL",
    blurb: "Cloud motion backend (Vidu i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_ALIBABA_WAN_URL",
    label: "Alibaba Wan module URL",
    blurb: "Cloud motion backend (Wan i2v).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_ALIBABA_WAN_LORA_URL",
    label: "Alibaba Wan LoRA module URL",
    blurb: "Cloud motion backend (Wan LoRA i2v). Delisted from default compose (vivijure #772); enable COMPOSE_PROFILES=wan-lora.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_MUSIC_GEN_URL",
    label: "music-gen module URL",
    blurb: "Score-chain music bed module sidecar.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_NARRATION_GEN_URL",
    label: "narration-gen module URL",
    blurb: "Score-chain narration TTS module sidecar.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_PLANENHANCE_URL",
    label: "plan.enhance module URL",
    blurb: "HTTP sidecar for the plan.enhance hook (model choice lives in the module).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_CAST_IMAGE_URL",
    label: "cast.image module URL",
    blurb: "HTTP sidecar for cast training-reference generation.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_DIALOGUE_URL",
    label: "dialogue module URL",
    blurb: "HTTP sidecar for per-shot dialogue TTS.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_SPEECH_UPSCALE_URL",
    label: "speech module URL",
    blurb: "HTTP sidecar for dialogue audio polish (speech hook).",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "MODULE_NOTIFY_EMAIL_URL",
    label: "notify module URL",
    blurb: "HTTP sidecar for render-complete email notifications.",
    category: "modules",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "ENHANCE_MODEL",
    label: "plan.enhance cloud model",
    blurb: "Optional override for the plan.enhance module Opus model id.",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "RENDER_SWEEP_INTERVAL_MS",
    label: "Render sweep interval (ms)",
    blurb: "Background advanceFilmJob tick when no client poll (default 60000). Use 15000 on GPU panels.",
    category: "media",
    sensitive: false,
    applies_on: "restart",
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
