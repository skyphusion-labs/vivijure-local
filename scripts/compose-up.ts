#!/usr/bin/env tsx
/**
 * `npm run compose:up` — pull + up, with a fail-closed preflight when
 * COMPOSE_PROFILES includes `edge` and MinIO still has minioadmin defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edgeProfileRefusesMinioPlaceholder } from "../src/minio-creds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

function readEnvFile(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
}

const fileEnv = readEnvFile(ENV_PATH);
const profiles = process.env.COMPOSE_PROFILES ?? fileEnv.get("COMPOSE_PROFILES") ?? "";
const access = process.env.S3_ACCESS_KEY_ID ?? fileEnv.get("S3_ACCESS_KEY_ID");
const secret = process.env.S3_SECRET_ACCESS_KEY ?? fileEnv.get("S3_SECRET_ACCESS_KEY");

if (edgeProfileRefusesMinioPlaceholder(profiles, access, secret)) {
  console.error(
    "REFUSING COMPOSE_PROFILES=edge with default MinIO credentials (minioadmin).\n" +
      "Run: npm run install:edge   (mints S3_*) before starting the public edge.",
  );
  process.exit(1);
}

const pull = spawnSync("docker", ["compose", "pull"], { cwd: ROOT, stdio: "inherit" });
if (pull.status !== 0) process.exit(pull.status ?? 1);
const up = spawnSync("docker", ["compose", "up", "-d"], { cwd: ROOT, stdio: "inherit" });
process.exit(up.status ?? 1);
