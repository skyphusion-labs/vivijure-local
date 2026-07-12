// Object store factory: S3-compatible (default) or filesystem fallback.

import type { ObjectPresigner } from "./types.js";
import { FilesystemObjectStore, LocalObjectPresigner, type StoredObject } from "./storage.js";
import { s3ConfigFromEnv, s3PresignConfig } from "./s3-config.js";
import { S3ObjectPresigner, S3ObjectStore } from "./s3-store.js";

/** Store surface used by artifacts, cast-media, and film job docs. */
export interface ArtifactStore {
  get(key: string): Promise<ArrayBuffer | null>;
  getBytes(key: string): Promise<StoredObject | null>;
  getRange(key: string, offset: number, length: number): Promise<Uint8Array | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
  head(key: string): Promise<import("./types.js").ObjectHead | null>;
  delete(key: string): Promise<void>;
}

export interface StorageBundle {
  renders: ArtifactStore;
  chatBucket: ArtifactStore;
  presigner: ObjectPresigner;
  backend: "s3" | "filesystem";
}

export function createStorage(env: NodeJS.ProcessEnv, opts?: { publicBase?: string; token?: string }): StorageBundle {
  const s3 = s3ConfigFromEnv(env);
  if (s3) {
    const clientCfg = {
      endpoint: s3.endpoint,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
    };
    return {
      backend: "s3",
      renders: new S3ObjectStore(s3.bucket, clientCfg),
      chatBucket: new S3ObjectStore(s3.chatBucket, clientCfg),
      presigner: new S3ObjectPresigner(s3PresignConfig(s3)),
    };
  }

  const root = env.ARTIFACT_ROOT || "./data/artifacts";
  const store = new FilesystemObjectStore(root);
  const publicBase = opts?.publicBase || env.PUBLIC_BASE_URL || "http://127.0.0.1:8790";
  return {
    backend: "filesystem",
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner(publicBase, opts?.token || env.STUDIO_API_TOKEN),
  };
}
