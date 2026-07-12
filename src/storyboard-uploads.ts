// Storyboard-scoped upload routes (audio bed + character refs).

import { badRequest } from "./errors.js";
import type { ArtifactStore } from "./platform/create-storage.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 32 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const AUDIO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

export async function handleStoryboardAudioUpload(req: Request, store: ArtifactStore): Promise<Response> {
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim() || "audio/mpeg";
  const ext = AUDIO_EXT[mime];
  if (!ext) throw badRequest(`unsupported audio content-type ${mime || "<missing>"}`);
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw badRequest("empty upload body");
  if (bytes.byteLength > MAX_AUDIO_UPLOAD_BYTES) throw badRequest("upload too large (max 32MB)");
  const key = `audio/${crypto.randomUUID()}.${ext}`;
  await store.put(key, bytes, { httpMetadata: { contentType: mime } });
  return Response.json({ key, mime, size: bytes.byteLength }, { status: 201 });
}

export async function handleStoryboardCharacterRef(req: Request, store: ArtifactStore): Promise<Response> {
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim() || "application/octet-stream";
  const ext = IMAGE_EXT[mime];
  if (!ext) throw badRequest(`unsupported content-type ${mime || "<missing>"} (png/jpeg/webp/gif only)`);
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw badRequest("empty upload body");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest("upload too large (max 25MB)");
  const key = `character-refs/${crypto.randomUUID()}.${ext}`;
  await store.put(key, bytes, { httpMetadata: { contentType: mime } });
  return Response.json({ key, mime, size: bytes.byteLength }, { status: 201 });
}
