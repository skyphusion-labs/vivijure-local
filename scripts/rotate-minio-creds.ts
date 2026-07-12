#!/usr/bin/env tsx
// Generate MinIO root credentials and update .env (run before first tunnel expose or to rotate).
// After running: npm run sync:tunnel-secrets && docker compose up -d --force-recreate minio minio-init studio

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const envPath = join(__dirname, "..", ".env");

function mintKey(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

if (!existsSync(envPath)) {
  console.error("missing .env -- copy .env.example first");
  process.exit(1);
}

const access = mintKey("vj");
const secret = randomBytes(32).toString("hex");
const lines = readFileSync(envPath, "utf8").split("\n");
const keys = new Set(["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
const out: string[] = [];
let wroteAccess = false;
let wroteSecret = false;

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    out.push(line);
    continue;
  }
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    out.push(line);
    continue;
  }
  const key = trimmed.slice(0, eq);
  if (key === "S3_ACCESS_KEY_ID") {
    out.push(`S3_ACCESS_KEY_ID=${access}`);
    wroteAccess = true;
    keys.delete(key);
    continue;
  }
  if (key === "S3_SECRET_ACCESS_KEY") {
    out.push(`S3_SECRET_ACCESS_KEY=${secret}`);
    wroteSecret = true;
    keys.delete(key);
    continue;
  }
  out.push(line);
}

if (!wroteAccess) out.push(`S3_ACCESS_KEY_ID=${access}`);
if (!wroteSecret) out.push(`S3_SECRET_ACCESS_KEY=${secret}`);

writeFileSync(envPath, out.join("\n").replace(/\n*$/, "\n"));
console.log("updated .env with new MinIO root credentials");
console.log("next: npm run sync:tunnel-secrets && docker compose up -d --force-recreate minio minio-init studio");
