// S3-compatible object store (MinIO / AWS S3 / Cloudflare R2).

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectHead, ObjectPresigner, ObjectStore } from "./types.js";
import { presignS3WithConfig, type S3PresignConfig } from "./s3-presign.js";
import type { StoredObject } from "./storage.js";

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    cfg: {
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      region: string;
      forcePathStyle: boolean;
    },
  ) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: cfg.forcePathStyle,
    });
  }

  async getBytes(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await bodyToBytes(out.Body);
      return {
        bytes,
        size: out.ContentLength ?? bytes.length,
        contentType: out.ContentType || "application/octet-stream",
      };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "NoSuchKey") {
        return null;
      }
      if (e && typeof e === "object" && "$metadata" in e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
      }
      throw e;
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

  async getRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${offset}-${offset + length - 1}`,
        }),
      );
      return bodyToBytes(out.Body);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "$metadata" in e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
      }
      throw e;
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const body =
      typeof value === "string"
        ? value
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.httpMetadata?.contentType,
      }),
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: out.ContentLength ?? 0,
        uploaded: out.LastModified,
        httpMetadata: out.ContentType ? { contentType: out.ContentType } : undefined,
      };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "$metadata" in e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
      }
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class S3ObjectPresigner implements ObjectPresigner {
  constructor(private readonly cfg: S3PresignConfig) {}

  async presignGet(key: string, expiresSec = 300): Promise<string> {
    return presignS3WithConfig(this.cfg, "GET", key, expiresSec);
  }

  async presignPut(key: string, contentType: string, expiresSec = 300): Promise<string> {
    void contentType;
    return presignS3WithConfig(this.cfg, "PUT", key, expiresSec);
  }
}
