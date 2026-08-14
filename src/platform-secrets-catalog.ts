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
    blurb: "Default homelab: video-finish + audio-master only. Optional profile media adds image prep, beat/mix.",
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
    key: "LOCAL_BACKEND_URL",
    label: "Local GPU backend URL",
    blurb:
      "Base URL for the homelab GPU door (local-gpu proxies here). Default path is the 16GB door " +
      "(http://vivijure-local-16gb:8000). 12GB door is the alternate.",
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
    key: "OLLAMA_BASE_URL",
    label: "Ollama base URL",
    blurb: "Homelab plan.enhance provider (default http://ollama:11434). Unload runs before local-gpu keyframe.",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "OLLAMA_PLAN_MODEL",
    label: "Ollama plan.enhance model",
    blurb:
      "Open-weight model tag for plan.enhance (default qwen3:14b ~9.3GB Q4; must fit 16GB with headroom before unload).",
    category: "ai",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "FINISH_BACKEND",
    label: "Finish GPU backend mode",
    blurb:
      "local (homelab default after local#180) or runpod (escape hatch). Sidecars proxy to LOCAL_FINISH_*_URL " +
      "or RunPod endpoint IDs for lipsync/upscale only. RIFE is RunPod/CF-only. See docs/FINISH_BACKEND.md.",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_FINISH_LIPSYNC_URL",
    label: "Local finish lipsync URL",
    blurb: "HTTP base for finish-lipsync when FINISH_BACKEND=local (MuseTalk on homelab GPU).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_FINISH_UPSCALE_URL",
    label: "Local finish upscale URL",
    blurb: "HTTP base for finish-upscale when FINISH_BACKEND=local (video upscale on homelab GPU).",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_FINISH_SPEECH_URL",
    label: "Local speech upscale URL",
    blurb:
      "HTTP base(s) for speech-upscale on your own box (comma-separated for several cards). " +
      "SET THIS AND NO SPEECH AUDIO GOES TO RUNPOD: presence wins over the RunPod endpoint, and a " +
      "value that resolves to no usable door degrades honestly rather than falling back to cloud.",
    category: "providers",
    sensitive: false,
    applies_on: "immediate",
  },
  {
    key: "LOCAL_FINISH_TOKEN",
    label: "Local finish backend token",
    blurb: "Optional bearer token for LOCAL_FINISH_*_URL services, including the speech door.",
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
    label: "Keyframe module URL (RunPod, cloud profile)",
    blurb:
      "HTTP base for the RunPod keyframe sidecar. Opt-in only (COMPOSE_PROFILES=cloud). " +
      "Default homelab keyframes use MODULE_LOCAL_GPU_URL.",
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
    blurb: "Cloud motion backend (Wan LoRA i2v). Re-listed with default compose (parity with cf v1.7.8 / 2x2 Wan LoRA sign-off).",
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
    blurb: "RunPod speech-upscale sidecar (vivijure-audio-upscale); cloud profile only.",
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
    // control-plane#130 twin. The LOCAL half of the abuse-report link, and the entry exists because
    // on this panel the reader IS the operator: publishing a contact for your own studio is a thing
    // you can actually do, so the knob belongs where you can find it. Unset means the panel shows no
    // link at all, which is correct rather than a gap -- this bundle ships no provider address to
    // fall back to, deliberately.
    key: "ABUSE_REPORT_URL",
    label: "Abuse report URL",
    blurb: "Where reports about content made on THIS studio should go (absolute http(s) URL). Unset means no link.",
    category: "media",
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

/** Module sidecar URLs synced from compose/.env (upsert when set, purge from DB when unset). */
export const PLATFORM_MODULE_URL_KEYS: readonly string[] = PLATFORM_SECRET_FIELDS.filter(
  (f) => f.category === "modules",
).map((f) => f.key);

/** Retired local RIFE keys: purge from platform_secrets when absent from env. */
export const PLATFORM_LEGACY_RIFE_KEYS = ["LOCAL_FINISH_RIFE_URL", "MODULE_FINISH_RIFE_URL"] as const;

/** Retired homelab Wan train key (CF prod only; Conrad ruling 2026-07-23). Purge when absent from env. */
export const PLATFORM_LEGACY_WAN_TRAIN_KEYS = ["RUNPOD_WAN_TRAIN_ENDPOINT_ID"] as const;

/** DERIVED keys: computed by the installer from another operator knob, so env/compose is the ONLY
 *  authority and platform_secrets must never hold a copy (local#281).
 *
 *  MODULE_LOCAL_GPU_URL is derived from LOCAL_BACKEND_URL by localGpuLaneUpdates: door set -> the
 *  `localgpu` profile plus the module URL, door cleared -> both dropped. A stored copy outlives the
 *  derivation it came from, and because RuntimeEnv merges DB OVER env with DB winning, that copy wins
 *  over the empty value the installer just wrote to .env -- so a studio with the lane deliberately off
 *  would still bind MODULE_LOCAL_GPU to a container the `localgpu` profile guarantees is not running.
 *  Three rules keep the copy from existing: bootstrap never seeds a derived key, sync purges it
 *  UNCONDITIONALLY (not merely when unset -- upserting the value while the lane is on would just
 *  rebuild the copy that goes stale the moment the lane goes off), and migration 0015 deletes the row
 *  every pre-local#280 studio already has.
 *
 *  A Settings-GUI write is deliberately still allowed: that row is one the operator chose and can see
 *  (the field reports source `database`), which is the opposite of the invisible seeded row above. */
export const PLATFORM_SECRET_DERIVED_KEYS: readonly string[] = ["MODULE_LOCAL_GPU_URL"];

/** Homelab compose defaults: hardcoded in compose.yaml, upsert when set, never purge when unset.
 *  MODULE_KEYFRAME_URL is NOT here -- RunPod keyframe is cloud-profile only (local#265).
 *  MODULE_LOCAL_GPU_URL is NOT here either: local#280 stopped hardcoding it in compose.yaml, so
 *  never-purge stopped being true for it (local#281). It is a derived key now, see above. */
export const PLATFORM_MODULE_URL_COMPOSE_DEFAULTS = [
  "MODULE_BEAT_SYNC_URL",
  "MODULE_AUDIO_MASTER_URL",
  "MODULE_FILM_TITLES_URL",
  "MODULE_SUBTITLE_URL",
  "MODULE_IMAGE_GENERATE_URL",
  "MODULE_MUSIC_GEN_URL",
  "MODULE_PLANENHANCE_URL",
  "MODULE_CAST_IMAGE_URL",
  "MODULE_DIALOGUE_URL",
  "MODULE_NOTIFY_EMAIL_URL",
] as const;

/** Optional cloud / satellite module URLs: upsert when set, purge from DB when unset in env.
 *  Derived keys are excluded: they are never upserted at all (see PLATFORM_SECRET_DERIVED_KEYS). */
export const PLATFORM_MODULE_URL_PURGEABLE_KEYS: readonly string[] = [
  ...PLATFORM_MODULE_URL_KEYS.filter(
    (k) =>
      !(PLATFORM_MODULE_URL_COMPOSE_DEFAULTS as readonly string[]).includes(k) &&
      !PLATFORM_SECRET_DERIVED_KEYS.includes(k),
  ),
  ...PLATFORM_LEGACY_RIFE_KEYS,
  ...PLATFORM_LEGACY_WAN_TRAIN_KEYS,
];

/** All MODULE_* URL keys handled by sync:secrets. */
export const PLATFORM_MODULE_URL_SYNC_KEYS: readonly string[] = [
  ...PLATFORM_MODULE_URL_COMPOSE_DEFAULTS,
  ...PLATFORM_MODULE_URL_PURGEABLE_KEYS,
  ...PLATFORM_SECRET_DERIVED_KEYS,
];

/** Install/bootstrap keys: never writable from the Settings GUI (install script / compose only). */
export const PLATFORM_SECRET_INSTALL_ONLY = new Set(["STUDIO_API_TOKEN", "DATABASE_PATH", "PORT"]);

/** Every key PATCH /api/settings/secrets must refuse to store.
 *
 *  Derived keys are here for the reason the whole of local#281 exists: a stored copy of a derived key
 *  outvotes env and outlives the derivation. That is true of a copy an OPERATOR typed as much as one
 *  boot seeded -- MODULE_LOCAL_GPU_URL set by hand to another host still wins over env after the lane
 *  is turned off, and still names a container the `localgpu` profile does not start. An earlier draft
 *  of this fix allowed the deliberate GUI write on the grounds that the operator can see it (the field
 *  reports source `database`); that carve-out contradicted sync:secrets, which purges derived keys
 *  unconditionally and cannot tell a typed row from a seeded one. Two rules disagreeing about the same
 *  row is the defect, not the fix. Env is the only authority, for everyone.
 *
 *  The field stays VISIBLE in Settings: reading the live value and its source is useful, and a
 *  read-only row is honest in a way a silently-discarded write is not. */
export const PLATFORM_SECRET_NOT_GUI_WRITABLE: ReadonlySet<string> = new Set([
  ...PLATFORM_SECRET_INSTALL_ONLY,
  ...PLATFORM_SECRET_DERIVED_KEYS,
]);

export function platformSecretField(key: string): PlatformSecretField | undefined {
  return PLATFORM_SECRET_FIELDS.find((f) => f.key === key);
}
