// Filesystem object store (v1 default). Keys match R2 layout: renders/<project>/...

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectHead, ObjectPresigner, ObjectStore } from "./types.js";

function safeKey(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("invalid object key");
  return normalized;
}

export class FilesystemObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    return join(this.root, safeKey(key));
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const buf = await readFile(this.path(key));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw e;
    }
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
      return { size: st.size, uploaded: st.mtime };
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
}

/** Local presigner: returns studio-routed URLs (artifact handler serves bytes). */
export class LocalObjectPresigner implements ObjectPresigner {
  constructor(
    private readonly publicBase: string,
    private readonly token?: string,
  ) {}

  async presignGet(key: string, _expiresSec?: number): Promise<string> {
    const q = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
    return `${this.publicBase}/api/artifact/${encodeURIComponent(key)}${q}`;
  }

  async presignPut(_key: string, _contentType: string, _expiresSec?: number): Promise<string> {
    // v1: CPU containers use GET-after-PUT via studio upload proxy; full PUT presign with MinIO in M2.
    throw new Error("presignPut not implemented for filesystem store; use MinIO or studio upload");
  }
}
