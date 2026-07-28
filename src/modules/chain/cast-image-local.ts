/**
 * Local cast.image HTTP backend (FLUX.2 Klein 4B sidecar; local#269).
 *
 * Wire contract for containers/cast-image:
 *   GET  /health   → { ok, configured, model?, gpu? }
 *   POST /generate → { prompt, width?, height?, ref_images?: base64[] } → { image, mime }
 *   POST /unload   → { ok }  (release VRAM for Ollama / local-gpu handoff)
 */
import { base64ToBytes, bytesToBase64 } from "../../utils.js";
import { sniffImageMime } from "../../chat-image-gen.js";

export const LOCAL_CAST_MODEL = "local/flux-2-klein-4b";
export const LOCAL_HF_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B";

export interface CastImageLocalEnv {
  CAST_IMAGE_BACKEND_URL?: string;
  CAST_IMAGE_BACKEND_TOKEN?: string;
}

export function castImageLocalBaseUrl(env: CastImageLocalEnv): string | null {
  const raw = env.CAST_IMAGE_BACKEND_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function castImageLocalConfigured(env: CastImageLocalEnv): boolean {
  return Boolean(castImageLocalBaseUrl(env));
}

export function isLocalCastModelId(id: string | undefined): boolean {
  if (!id?.trim()) return false;
  const s = id.trim().toLowerCase();
  // Only local/* ids — do not match @cf/.../flux-2-klein-4b (CF opt-in overlay).
  return s === LOCAL_CAST_MODEL || s.startsWith("local/");
}

function authHeaders(env: CastImageLocalEnv): Record<string, string> {
  const tok = env.CAST_IMAGE_BACKEND_TOKEN?.trim();
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function fetchRefBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function callLocalCastImage(
  env: CastImageLocalEnv,
  prompt: string,
  refUrls: string[],
  opts?: { width?: number; height?: number },
): Promise<{ bytes: Uint8Array; mime: string }> {
  const base = castImageLocalBaseUrl(env);
  if (!base) throw new Error("cast.image local requires CAST_IMAGE_BACKEND_URL");

  const ref_images: string[] = [];
  for (const url of refUrls) {
    if (ref_images.length >= 4) break;
    const bytes = await fetchRefBytes(url);
    if (!bytes) continue;
    ref_images.push(bytesToBase64(bytes));
  }

  const resp = await fetch(`${base}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(env),
    },
    body: JSON.stringify({
      prompt,
      width: opts?.width ?? 1024,
      height: opts?.height ?? 1024,
      model: LOCAL_HF_MODEL_ID,
      ref_images,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`cast.image local ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await resp.json()) as { image?: string; mime?: string; error?: string };
  if (data.error) throw new Error(`cast.image local: ${data.error}`);
  if (!data.image || typeof data.image !== "string") {
    throw new Error("cast.image local returned no image");
  }
  const bytes = base64ToBytes(data.image);
  const mime =
    typeof data.mime === "string" && data.mime.startsWith("image/")
      ? data.mime
      : sniffImageMime(bytes).mime;
  return { bytes, mime };
}

/** Best-effort VRAM release; never throws. */
export async function unloadLocalCastImageBestEffort(env: CastImageLocalEnv): Promise<boolean> {
  const base = castImageLocalBaseUrl(env);
  if (!base) return false;
  try {
    const resp = await fetch(`${base}/unload`, {
      method: "POST",
      headers: { ...authHeaders(env) },
    });
    if (!resp.ok) {
      console.warn(`cast.image local unload ${resp.status} (continuing)`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`cast.image local unload failed (continuing): ${(e as Error).message}`);
    return false;
  }
}
