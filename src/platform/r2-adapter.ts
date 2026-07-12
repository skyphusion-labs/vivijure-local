// R2-shaped bucket API over platform ObjectStore (Workers R2 compatibility layer).

import type { ObjectStore } from "./types.js";
import {
  ObjectStoreR2Bucket,
  wrapR2Bucket,
  type R2Bucket,
  type R2GetOptions,
  type R2ListResult,
  type R2ListedObject,
  type R2ObjectBody,
} from "@skyphusion-labs/vivijure-core/platform";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

export type { R2ObjectBody, R2ListedObject, R2ListResult, R2GetOptions, R2Bucket };
export { ObjectStoreR2Bucket, wrapR2Bucket };

type StoreWithRange = ObjectStore & {
  getRange?(key: string, offset: number, length: number): Promise<Uint8Array | null>;
};

export class FilesystemListStore implements ObjectStore {
  constructor(
    private readonly inner: StoreWithRange,
    private readonly root: string,
  ) {}

  get(key: string, opts?: R2GetOptions) {
    if (opts?.range && this.inner.getRange) {
      return this.inner.getRange(key, opts.range.offset, opts.range.length).then((b) =>
        b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null,
      );
    }
    return this.inner.get(key);
  }
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
    return this.inner.put(key, value, opts);
  }
  head(key: string) {
    return this.inner.head(key);
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
  getRange(key: string, offset: number, length: number) {
    return this.inner.getRange?.(key, offset, length) ?? Promise.resolve(null);
  }

  async list(prefix: string): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    const base = join(this.root, prefix.replace(/^\/+/, ""));
    async function walk(dir: string, rel: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.endsWith(".content-type")) continue;
        const p = join(dir, ent.name);
        const relKey = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(p, relKey);
        else {
          const fullKey = (prefix.endsWith("/") ? prefix : prefix + "/") + relKey;
          keys.push(fullKey.replace(/\/+/g, "/"));
        }
      }
    }
    await walk(base, "");
    return { keys: keys.sort() };
  }
}

export class S3ListStore implements ObjectStore {
  constructor(
    private readonly inner: StoreWithRange,
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  get(key: string) {
    return this.inner.get(key);
  }
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
    return this.inner.put(key, value, opts);
  }
  head(key: string) {
    return this.inner.head(key);
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
  getRange(key: string, offset: number, length: number) {
    return this.inner.getRange?.(key, offset, length) ?? Promise.resolve(null);
  }

  async list(prefix: string): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const o of out.Contents ?? []) {
        if (o.Key) keys.push(o.Key);
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return { keys };
  }
}

export { asFetcher } from "@skyphusion-labs/vivijure-core/platform";
