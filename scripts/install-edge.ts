#!/usr/bin/env tsx
/**
 * Novice-friendly edge prep: one command that detects DNS, writes config, and
 * (when needed) walks the operator through manual certificate issuance.
 *
 * Exit codes:
 *   0 = ready for COMPOSE_PROFILES=edge
 *   2 = operator action still needed (no TTY / declined cert step / missing token)
 *   1 = hard misconfiguration
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEdgeDnsChecklist,
  formatEdgeDnsChecklist,
} from "./print-edge-dns.js";
import { writeSitesRuntime, type CaddyTlsMode } from "./render-caddy-sites.js";
import type { DnsProviderId } from "./dns-provider-detect.js";
import {
  isMinioCredsPlaceholder,
  mintMinioAccessKey,
  mintMinioSecretKey,
} from "../src/minio-creds.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
const CERTS_DIR = join(ROOT, "reverse-proxy", "certs");
const ISSUE_CERTS_SCRIPT = join(ROOT, "scripts", "issue-edge-certs-manual.sh");

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

function upsertEnvKeys(path: string, updates: Record<string, string>): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing ? existing.split("\n") : [];
  const touched = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("="));
    if (key in updates) {
      lines[i] = `${key}=${updates[key]}`;
      touched.add(key);
    }
  }

  const missing = Object.entries(updates).filter(([k]) => !touched.has(k));
  if (missing.length) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# --- Edge HTTPS (added by npm run install:edge) ---");
    for (const [k, v] of missing) lines.push(`${k}=${v}`);
  }

  writeFileSync(path, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function filesCertsPresent(): boolean {
  return (
    existsSync(join(CERTS_DIR, "studio.pem")) &&
    existsSync(join(CERTS_DIR, "studio.key")) &&
    existsSync(join(CERTS_DIR, "minio.pem")) &&
    existsSync(join(CERTS_DIR, "minio.key"))
  );
}

function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY) && process.env.CI !== "true";
}

async function askYes(question: string, defaultYes = true): Promise<boolean> {
  if (!isInteractive()) return false;
  const rl = createInterface({ input, output });
  try {
    const hint = defaultYes ? "Y/n" : "y/N";
    const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function runManualCertIssue(): number {
  const result = spawnSync("bash", [ISSUE_CERTS_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function printReadyNext(studioHost: string): void {
  console.log("");
  console.log("You are ready. Start the public edge with:");
  console.log("  COMPOSE_PROFILES=edge npm run compose:up");
  console.log(`Then check: curl -fsS https://${studioHost}/health`);
}

async function main(): Promise<void> {
  const dryRun =
    process.env.INSTALL_EDGE_DRY_RUN === "1" || process.env.INSTALL_EDGE_DRY_RUN === "true";
  const env = readEnvFile(ENV_PATH);
  const studioHost =
    process.env.CADDY_APP_HOST ||
    env.get("CADDY_APP_HOST") ||
    process.env.STUDIO_HOST ||
    env.get("STUDIO_HOST") ||
    "";
  const minioHost =
    process.env.CADDY_MINIO_HOST ||
    env.get("CADDY_MINIO_HOST") ||
    process.env.MINIO_HOST ||
    env.get("MINIO_HOST") ||
    "";

  if (!studioHost || !minioHost) {
    console.error("Almost there. Add these two lines to .env, then re-run npm run install:edge:");
    console.error("");
    console.error("  CADDY_APP_HOST=studio.example.com");
    console.error("  CADDY_MINIO_HOST=s3.example.com");
    console.error("  EDGE_PUBLIC_IP=<your public IP or load balancer VIP>");
    console.error("  CADDY_ACME_EMAIL=you@example.com");
    process.exit(1);
  }

  // Public edge terminates TLS for MinIO -- refuse default minioadmin root creds.
  const s3Access = process.env.S3_ACCESS_KEY_ID || env.get("S3_ACCESS_KEY_ID") || "";
  const s3Secret = process.env.S3_SECRET_ACCESS_KEY || env.get("S3_SECRET_ACCESS_KEY") || "";
  if (isMinioCredsPlaceholder(s3Access, s3Secret)) {
    if (dryRun) {
      console.error(
        "Edge install refuses default MinIO credentials (minioadmin). " +
          "Run without INSTALL_EDGE_DRY_RUN to mint, or: npm run rotate:minio-creds",
      );
      process.exit(1);
    }
    const access = mintMinioAccessKey();
    const secret = mintMinioSecretKey();
    upsertEnvKeys(ENV_PATH, {
      S3_ACCESS_KEY_ID: access,
      S3_SECRET_ACCESS_KEY: secret,
    });
    chmodSync(ENV_PATH, 0o600);
    env.set("S3_ACCESS_KEY_ID", access);
    env.set("S3_SECRET_ACCESS_KEY", secret);
    console.log("Minted S3_* credentials (replaced minioadmin defaults).");
    console.log(
      "If MinIO already ran with the old root user: npm run sync:secrets && " +
        "docker compose up -d --force-recreate minio minio-init studio",
    );
    console.log("---");
  }

  const checklist = await buildEdgeDnsChecklist({
    studioHost,
    minioHost,
    publicIp: process.env.EDGE_PUBLIC_IP || env.get("EDGE_PUBLIC_IP"),
  });

  console.log(formatEdgeDnsChecklist(checklist));
  console.log("---");

  const email =
    process.env.CADDY_ACME_EMAIL || env.get("CADDY_ACME_EMAIL") || "you@example.com";
  const explicitTls = process.env.CADDY_TLS_MODE || env.get("CADDY_TLS_MODE");
  const provider = (process.env.CADDY_DNS_PROVIDER ||
    env.get("CADDY_DNS_PROVIDER") ||
    checklist.provider?.id ||
    "") as DnsProviderId | "";

  const baseUpdates: Record<string, string> = {
    CADDY_APP_HOST: studioHost,
    CADDY_MINIO_HOST: minioHost,
    CADDY_ACME_EMAIL: email,
    EDGE_PUBLIC_IP: checklist.publicIp,
    PUBLIC_BASE_URL: `https://${studioHost}`,
    S3_PRESIGN_ENDPOINT: `https://${minioHost}`,
    MINIO_PUBLIC_DOMAIN: minioHost,
    S3_FETCH_ALLOW_HOSTS: `minio,${minioHost}`,
    S3_ALLOW_HTTP_FETCH: "false",
  };

  // --- Path: stay on current DNS (manual certs / files) ---
  if (!checklist.provider && !provider) {
    const updates = { ...baseUpdates, CADDY_TLS_MODE: "files" };

    if (!dryRun) {
      writeSitesRuntime({
        appHost: studioHost,
        minioHost,
        provider: "",
        tlsMode: "files",
      });
      upsertEnvKeys(ENV_PATH, updates);
      console.log("Saved edge settings (CADDY_TLS_MODE=files).");
    } else {
      console.log("(dry-run: did not write .env or sites.runtime.caddyfile)");
    }

    if (filesCertsPresent()) {
      printReadyNext(studioHost);
      process.exit(0);
    }

    if (dryRun) {
      console.log("Dry-run stop: would offer interactive certificate setup next.");
      process.exit(2);
    }

    console.log("");
    if (isInteractive()) {
      const go = await askYes(
        "Finish HTTPS now? We will show each TXT record to paste into your DNS panel.",
        true,
      );
      if (go) {
        console.log("");
        console.log("Starting guided certificate setup...");
        const code = runManualCertIssue();
        if (code !== 0) {
          console.error("");
          console.error("Certificate step did not finish. Fix the error above, then re-run:");
          console.error("  npm run install:edge");
          process.exit(code === 2 ? 2 : 1);
        }
        if (filesCertsPresent()) {
          printReadyNext(studioHost);
          process.exit(0);
        }
      }
    }

    console.log("");
    console.log("When you are ready to finish HTTPS (same machine, with a keyboard):");
    console.log("  npm run install:edge");
    console.log("Or jump straight to the cert helper:");
    console.log("  npm run issue:edge-certs");
    console.log("");
    console.log("Easier long-term: move DNS to Cloudflare (or another supported host)");
    console.log("and re-run install:edge so TXT records happen automatically.");
    process.exit(2);
  }

  // --- Path: supported DNS API (Caddy handles TXT) ---
  const tlsMode = (explicitTls || "dns") as CaddyTlsMode;
  if (tlsMode === "dns" && !provider) {
    console.error("Could not pick a DNS provider. Set CADDY_DNS_PROVIDER or CADDY_TLS_MODE=files.");
    process.exit(2);
  }

  const updates: Record<string, string> = { ...baseUpdates, CADDY_TLS_MODE: tlsMode };
  if (provider) updates.CADDY_DNS_PROVIDER = provider;

  if (!dryRun) {
    writeSitesRuntime({
      appHost: studioHost,
      minioHost,
      provider,
      tlsMode: tlsMode === "auto" ? "dns" : tlsMode,
    });
    upsertEnvKeys(ENV_PATH, updates);
    console.log("Saved edge settings for automatic HTTPS.");
  } else {
    console.log("(dry-run: did not write sites.runtime.caddyfile)");
  }

  if (tlsMode === "files" && !filesCertsPresent()) {
    console.log("");
    console.log("CADDY_TLS_MODE=files but cert files are not in reverse-proxy/certs/ yet.");
    if (isInteractive() && !dryRun) {
      const go = await askYes("Run guided certificate setup now?", true);
      if (go) {
        const code = runManualCertIssue();
        if (code === 0 && filesCertsPresent()) {
          printReadyNext(studioHost);
          process.exit(0);
        }
      }
    }
    console.log("Add PEM files or run: npm run issue:edge-certs");
    process.exit(2);
  }

  // Missing API token reminder (common friction)
  if (tlsMode === "dns" && provider === "cloudflare") {
    const token = process.env.CF_DNS_TOKEN || env.get("CF_DNS_TOKEN") || "";
    if (!token) {
      console.log("");
      console.log("One more paste into .env before compose:");
      console.log("  CF_DNS_TOKEN=<Cloudflare API token with Zone DNS Edit>");
      console.log("Then:");
      printReadyNext(studioHost);
      process.exit(0);
    }
  }

  printReadyNext(studioHost);
}

const isMain =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]!);

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
