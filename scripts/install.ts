#!/usr/bin/env tsx
// Novice install: mint studio token, persist .env + token file, migrate DB, seed platform_secrets.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapPlatformSecretsFromEnv,
  isStudioApiTokenPlaceholder,
  STUDIO_API_TOKEN_PLACEHOLDER,
} from "../src/platform-secrets-bootstrap.js";
import { migrateDatabase, openDatabase } from "../src/platform/sqlite.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const envPath = join(repoRoot, ".env");
const envExamplePath = join(repoRoot, ".env.example");
const tokenPath = join(repoRoot, ".studio-token");
const dbPath = process.env.DATABASE_PATH ?? join(repoRoot, "data", "studio.db");

function readEnvFile(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map();
  const out = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
}

function writeEnvFile(path: string, vars: Map<string, string>): void {
  const lines: string[] = [];
  if (existsSync(envExamplePath)) {
    for (const line of readFileSync(envExamplePath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        lines.push(line);
        continue;
      }
      const key = trimmed.slice(0, trimmed.indexOf("="));
      if (vars.has(key)) {
        lines.push(`${key}=${vars.get(key)}`);
        vars.delete(key);
      } else {
        lines.push(line);
      }
    }
  }
  for (const [key, value] of vars) {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"));
}

function mintStudioToken(): string {
  return randomBytes(32).toString("hex");
}

if (!existsSync(envPath)) {
  if (!existsSync(envExamplePath)) {
    console.error("missing .env and .env.example");
    process.exit(1);
  }
  copyFileSync(envExamplePath, envPath);
  console.log("created .env from .env.example");
}

const envVars = readEnvFile(envPath);
let token = envVars.get("STUDIO_API_TOKEN");
let minted = false;

if (isStudioApiTokenPlaceholder(token)) {
  token = mintStudioToken();
  envVars.set("STUDIO_API_TOKEN", token);
  writeEnvFile(envPath, envVars);
  minted = true;
  console.log(`minted STUDIO_API_TOKEN (replaced placeholder ${STUDIO_API_TOKEN_PLACEHOLDER})`);
}

// #45: .env holds STUDIO_API_TOKEN (gates every /api call) plus S3_SECRET_ACCESS_KEY / CF_AIG_TOKEN /
// etc. copyFileSync + writeEnvFile use the umask (typically 0644), so lock it down to match the sibling
// .studio-token. Unconditional so it covers both the from-example copy and the token-mint rewrite paths.
chmodSync(envPath, 0o600);

writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
chmodSync(tokenPath, 0o600);

mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(repoRoot, "migrations"));
const db = openDatabase(dbPath);

const bootstrapEnv: NodeJS.ProcessEnv = { ...process.env };
for (const [key, value] of envVars) bootstrapEnv[key] = value;

const { seeded } = await bootstrapPlatformSecretsFromEnv(db, bootstrapEnv);

console.log(`operator token file: ${tokenPath} (mode 0600; value not printed)`);
if (seeded.length) console.log(`platform_secrets seeded: ${seeded.join(", ")}`);
if (minted) {
  console.log("next: npm run compose:up   # or npm run dev");
  console.log("paste the token from .studio-token when the UI login gate appears");
}
