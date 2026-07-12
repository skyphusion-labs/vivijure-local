// R2-shaped bucket API over platform ObjectStore (Workers R2 compatibility layer).

import type { ObjectHead, ObjectStore } from "./types.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

export interface R2ObjectBody {
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: Uint8Array;
}

export interface R2ListedObject {
  key: string;
  uploaded: Date;
}

export interface R2ListResult {
  objects: R2ListedObject[];
  truncated: boolean;
  cursor?: string;
}

export interface R2GetOptions {
  range?: { offset: number; length: number };
}

export interface R2Bucket {
  get(key: string, opts?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string | Uint8Array | ArrayBuffer | R2ObjectBody,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
  head(key: string): Promise<(ObjectHead & { etag?: string }) | null>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<R2ListResult>;
  delete(key: string): Promise<void>;
}

function toBody(bytes: Uint8Array): R2ObjectBody {
  return {
    body: bytes,
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json<T>() {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

type StoreWithRange = ObjectStore & {
  getRange?(key: string, offset: number, length: number): Promise<Uint8Array | null>;
};

export class ObjectStoreR2Bucket implements R2Bucket {
  constructor(private readonly store: StoreWithRange) {}

  async get(key: string, opts?: R2GetOptions): Promise<R2ObjectBody | null> {
    if (opts?.range && this.store.getRange) {
      const slice = await this.store.getRange(key, opts.range.offset, opts.range.length);
      if (!slice) return null;
      return toBody(slice);
    }
    const buf = await this.store.get(key);
    if (!buf) return null;
    return toBody(new Uint8Array(buf));
  }

  async put(
    key: string,
    value: string | Uint8Array | ArrayBuffer | R2ObjectBody,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    let payload: ArrayBuffer | Uint8Array | string;
    if (typeof value === "object" && value !== null && "body" in value) {
      payload = value.body;
    } else {
      payload = value;
    }
    await this.store.put(key, payload, opts);
  }

  async head(key: string) {
    return this.store.head(key);
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  async list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<R2ListResult> {
    if (!this.store.list) {
      return { objects: [], truncated: false };
    }
    const keys = (await this.store.list(opts.prefix)).keys;
    const start = opts.cursor ? Number(opts.cursor) || 0 : 0;
    const limit = opts.limit ?? 1000;
    const slice = keys.slice(start, start + limit);
    const objects: R2ListedObject[] = [];
    for (const key of slice) {
      const h = await this.store.head(key);
      objects.push({ key, uploaded: h?.uploaded ?? new Date(0) });
    }
    const truncated = start + limit < keys.length;
    return {
      objects,
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }
}

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

export function wrapR2Bucket(store: ObjectStore): R2Bucket {
  return new ObjectStoreR2Bucket(store as StoreWithRange);
}

export function asFetcher(v: unknown): { fetch: typeof fetch } | null {
  if (v && typeof (v as { fetch?: unknown }).fetch === "function") {
    return v as { fetch: typeof fetch };
  }
  return null;
}
