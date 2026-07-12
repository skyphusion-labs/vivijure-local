// Chat-side artifacts (chat bucket): image outputs from POST /api/chat image models.

import type { ObjectStore } from "./platform/types.js";
import { extFromMime } from "./utils.js";

export interface OutputArtifact {
  key: string;
  mime: string;
  type: "image";
}

export async function putChatArtifact(
  store: ObjectStore,
  mime: string,
  bytes: Uint8Array,
): Promise<OutputArtifact> {
  const key = `out/${crypto.randomUUID()}.${extFromMime(mime)}`;
  await store.put(key, bytes, { httpMetadata: { contentType: mime } });
  return { key, mime, type: "image" };
}
