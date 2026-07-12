// Provider-neutral S3 object store configuration (MinIO, AWS S3, Cloudflare R2).

export interface S3StoreConfig {
  endpoint: string;
  /** Host embedded in presigned URLs (defaults to endpoint). Use when API clients use a different host than fetchers (docker compose). */
  presignEndpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  chatBucket: string;
  region: string;
  forcePathStyle: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

/** Read S3 config from env. Supports legacy MINIO_* aliases. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3StoreConfig | null {
  const endpoint = env.S3_ENDPOINT || env.MINIO_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD;
  const bucket = env.S3_BUCKET || env.MINIO_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;

  const chatBucket = env.S3_CHAT_BUCKET || env.S3_BUCKET || env.MINIO_BUCKET || bucket;
  const region = env.S3_REGION || (endpoint.includes("r2.cloudflarestorage.com") ? "auto" : "us-east-1");
  const forcePathStyle = envFlag("S3_FORCE_PATH_STYLE", !endpoint.includes("amazonaws.com"));
  const presignEndpoint = (env.S3_PRESIGN_ENDPOINT || "").replace(/\/$/, "") || undefined;

  return {
    endpoint: endpoint.replace(/\/$/, ""),
    presignEndpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    chatBucket,
    region,
    forcePathStyle,
  };
}

export function s3PresignConfig(cfg: S3StoreConfig, bucket = cfg.bucket) {
  return {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    endpoint: cfg.presignEndpoint || cfg.endpoint,
    bucket,
    region: cfg.region,
  };
}
