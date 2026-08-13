// Filesystem object store (v1 default). Keys match R2 layout: renders/<project>/...

import { readFile, mkdir, rm, stat, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectHead, ObjectPresigner, ObjectStore } from "./types.js";

export interface StoredObject {
  bytes: Uint8Array;
  size: number;
  contentType: string;
}

function safeKey(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("invalid object key");
  return normalized;
}

export class FilesystemObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  pathFor(key: string): string {
    return this.path(key);
  }

  private path(key: string): string {
    return join(this.root, safeKey(key));
  }

  private async readContentType(key: string): Promise<string | undefined> {
    try {
      return (await readFile(this.path(key) + ".content-type", "utf8")).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const obj = await this.getBytes(key);
    if (!obj) return null;
    return obj.bytes.buffer.slice(
      obj.bytes.byteOffset,
      obj.bytes.byteOffset + obj.bytes.byteLength,
    ) as ArrayBuffer;
  }

  async getBytes(key: string): Promise<StoredObject | null> {
    try {
      const buf = await readFile(this.path(key));
      const ct = (await this.readContentType(key)) || "application/octet-stream";
      return { bytes: new Uint8Array(buf), size: buf.length, contentType: ct };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw e;
    }
  }

  async getRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    const obj = await this.getBytes(key);
    if (!obj) return null;
    return obj.bytes.slice(offset, offset + length);
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    if (typeof value === "string") {
      await writeFile(p, value, "utf8");
    } else if (value instanceof Uint8Array) {
      await writeFile(p, value);
    } else {
      await writeFile(p, Buffer.from(new Uint8Array(value)));
    }
    if (opts?.httpMetadata?.contentType) {
      await writeFile(p + ".content-type", opts.httpMetadata.contentType, "utf8");
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const st = await stat(this.path(key));
      const ct = await this.readContentType(key);
      return {
        size: st.size,
        uploaded: st.mtime,
        httpMetadata: ct ? { contentType: ct } : undefined,
      };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async list(prefix: string): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    const base = join(this.root, prefix.replace(/^\/+/, ""));
    const walk = async (dir: string, rel: string) => {
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
          // An EMPTY prefix means "the whole store", and it must return keys spelled exactly as they
          // were written ("renders/a.mp4"), not with a leading slash. The old form always prepended a
          // separator, so a full-store list handed back "/renders/a.mp4": a different spelling of the
          // same object, which makes any key-indexed consumer (the core#52 storage ledger) hold rows a
          // later delete can never match, and drift high forever. Found while wiring the storage
          // reconcile, which is the first caller to pass an empty prefix.
          const fullKey = prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") + relKey : relKey;
          keys.push(fullKey.replace(/\/+/g, "/"));
        }
      }
    };
    await walk(base, "");
    return { keys: keys.sort() };
  }
}

/** Local presigner: the filesystem backend has no independent capability mechanism, so it cannot
 *  produce a URL that is genuinely scoped to one key AND genuinely expires (local#309 / cf#317
 *  twin). The old behavior here embedded the full studio bearer token as a `?token=` query param
 *  (grants everything the token grants, not one object) and silently ignored `_expiresSec` (never
 *  expires) -- the exact inverse of the two guarantees a presigned URL is supposed to carry, and it
 *  would have shipped quietly because the API shape still advertised a TTL. Refusing honestly beats
 *  pretending: presignGet throws instead, and /api/artifact-url turns that into a 503 naming what to
 *  configure. constructor params kept for compatibility with existing callers/tests that construct
 *  this class as a Platform.presigner stand-in without exercising presignGet. */
export class LocalObjectPresigner implements ObjectPresigner {
  constructor(
    private readonly _publicBase: string,
    private readonly _token?: string,
  ) {}

  async presignGet(_key: string, _expiresSec?: number): Promise<string> {
    throw new Error(
      "the filesystem artifact store cannot mint a scoped, expiring URL: a public link off it would " +
        "have to embed the full studio bearer token to authenticate at all, and any TTL passed to it " +
        "would be silently ignored; configure MinIO or another S3-compatible store (S3_ENDPOINT, " +
        "S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, or the legacy MINIO_* aliases) to serve " +
        "/api/artifact-url",
    );
  }

  async presignPut(_key: string, _contentType: string, _expiresSec?: number): Promise<string> {
    // v1: CPU containers use GET-after-PUT via studio upload proxy; full PUT presign with MinIO in M2.
    throw new Error("presignPut not implemented for filesystem store; use MinIO or studio upload");
  }
}
