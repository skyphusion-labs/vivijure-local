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

/** Parse endpoint hostname; malformed URLs yield null (not a trusted host). */
function endpointHostname(endpoint: string): string | null {
  try {
    return new URL(endpoint).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Exact host or subdomain match on a dot boundary (not substring). */
function hostMatchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

/** Read S3 config from env. Supports legacy MINIO_* aliases. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3StoreConfig | null {
  const endpoint = env.S3_ENDPOINT || env.MINIO_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY_ID || env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD;
  const bucket = env.S3_BUCKET || env.MINIO_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;

  // S3_CHAT_BUCKET is RETIRED (cf#129 phase 2 / vivijure-cf#140). It used to let chat artifacts live
  // in a different bucket from everything else, but /api/artifact only ever served the MAIN bucket,
  // so setting it silently broke every chat image preview: written successfully, then 404 on read,
  // with no error anywhere. It is now inert -- chat artifacts live in the served bucket, always.
  // Warn rather than fail: an operator who set it should learn it stopped mattering, not have their
  // studio refuse to boot on an upgrade.
  if (env.S3_CHAT_BUCKET && env.S3_CHAT_BUCKET !== bucket) {
    console.warn(
      "S3_CHAT_BUCKET is retired and IGNORED (vivijure-cf#140): chat artifacts are stored in " +
        `S3_BUCKET ("${bucket}") so that /api/artifact can serve them. Remove it from your env.`,
    );
  }
  const chatBucket = bucket;
  const host = endpointHostname(endpoint);
  const isR2 = host !== null && hostMatchesSuffix(host, "r2.cloudflarestorage.com");
  const isAws = host !== null && hostMatchesSuffix(host, "amazonaws.com");
  const region = env.S3_REGION || (isR2 ? "auto" : "us-east-1");
  const forcePathStyle = envFlag("S3_FORCE_PATH_STYLE", !isAws);
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
    forcePathStyle: cfg.forcePathStyle, // #54: honor vhost-style signing when the store is configured for it
  };
}
