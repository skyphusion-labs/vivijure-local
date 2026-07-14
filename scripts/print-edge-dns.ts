/**
 * Print the DNS A/AAAA checklist for the Caddy edge, and detect a DNS-01 provider from NS.
 * Copy aims for a novice operator: fewest steps first, plain language.
 */
import { resolve4, resolve as dnsResolve } from "node:dns/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apexFromHostname, detectDnsProvider, type DnsProviderInfo } from "./dns-provider-detect.js";

export interface EdgeDnsChecklist {
  studioHost: string;
  minioHost: string;
  publicIp: string;
  apex: string;
  nameservers: string[];
  provider: DnsProviderInfo | null;
}

export async function lookupNameservers(apex: string): Promise<string[]> {
  try {
    return await dnsResolve(apex, "NS");
  } catch {
    return [];
  }
}

/** Best-effort public IP hint (operator should set EDGE_PUBLIC_IP). */
export async function suggestPublicIp(): Promise<string> {
  if (process.env.EDGE_PUBLIC_IP?.trim()) return process.env.EDGE_PUBLIC_IP.trim();
  try {
    const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(4000) });
    if (res.ok) return (await res.text()).trim();
  } catch {
    /* ignore */
  }
  return "<your public IP or load balancer VIP>";
}

export async function buildEdgeDnsChecklist(opts: {
  studioHost: string;
  minioHost: string;
  publicIp?: string;
  /** When true, skip NS detect (manual / unsupported path). */
  forceUnsupported?: boolean;
}): Promise<EdgeDnsChecklist> {
  const studioHost = opts.studioHost.trim();
  const minioHost = opts.minioHost.trim();
  const apex = apexFromHostname(studioHost || minioHost);
  const forceUnsupported =
    opts.forceUnsupported === true ||
    process.env.EDGE_FORCE_UNSUPPORTED_DNS === "1" ||
    process.env.EDGE_FORCE_UNSUPPORTED_DNS === "true";
  const nameservers = forceUnsupported ? [] : apex ? await lookupNameservers(apex) : [];
  const provider = forceUnsupported ? null : detectDnsProvider(nameservers);
  const publicIp = opts.publicIp?.trim() || (await suggestPublicIp());
  return { studioHost, minioHost, publicIp, apex, nameservers, provider };
}

/** Traffic DNS records every operator must create (auto SSL or manual certs). */
export function formatRequiredTrafficDns(c: EdgeDnsChecklist): string[] {
  return [
    "Point these names at your box (create in your DNS panel):",
    "",
    `  Type    Name                              Value`,
    `  A/AAAA  ${c.studioHost}               ${c.publicIp}`,
    `  A/AAAA  ${c.minioHost}                  ${c.publicIp}`,
    `  A/AAAA  *.${c.minioHost}                ${c.publicIp}`,
    "",
    `Use EDGE_PUBLIC_IP=${c.publicIp} in .env so this list matches next time.`,
    "The star name covers bucket URLs like vivijure." + c.minioHost + " (needed for GPU tools).",
  ];
}

/**
 * ACME DNS-01 TXT names for manual issuance.
 * Values are NOT known until certificate issuance runs.
 */
export function formatRequiredAcmeTxtDns(c: EdgeDnsChecklist): string[] {
  return [
    "For HTTPS we also need short-lived TXT records (Let's Encrypt challenge):",
    "",
    `  Type  Name                                         Value`,
    `  TXT   _acme-challenge.${c.studioHost}        <we will show the exact value>`,
    `  TXT   _acme-challenge.${c.minioHost}           <we will show the exact value>`,
    "",
    "The MinIO wildcard (*.minio-host) requires that second TXT. We cannot invent the",
    "value early; Let's Encrypt picks it when you issue the certificate.",
  ];
}

export function formatUnsupportedProviderBanner(c: EdgeDnsChecklist): string[] {
  const nsLine =
    c.nameservers.length > 0
      ? `Your DNS host looks like: ${c.nameservers.join(", ")}`
      : c.apex
        ? `We could not auto-connect to the DNS host for ${c.apex}.`
        : "We could not auto-connect to your DNS host.";

  return [
    "----------------------------------------------------------------",
    " Your DNS provider is not set up for automatic SSL here.",
    " (We cannot create the Let's Encrypt TXT records for you.)",
    "----------------------------------------------------------------",
    "",
    nsLine,
    "",
    "Pick the path with the least work for you:",
    "",
    "  EASIEST -- switch this domain's DNS to a supported host",
    "            (Cloudflare free DNS is fine), then run",
    "            npm run install:edge again. Caddy will handle HTTPS,",
    "            including the MinIO wildcard. No hand-made TXT records.",
    "            Supported: Cloudflare, Route 53, DigitalOcean,",
    "            Google Cloud DNS, Hetzner, OVH.",
    "",
    "  STAY HERE -- keep your current DNS. Add the A/AAAA names below,",
    "               then finish this same install (we walk you through",
    "               the TXT values when Let's Encrypt asks for them).",
    "",
    ...formatRequiredTrafficDns(c),
    "",
    ...formatRequiredAcmeTxtDns(c),
    "",
    "You do not need a separate docs hunt. Stay with npm run install:edge;",
    "it will offer to issue certificates next when you are at a terminal.",
  ];
}

export function formatSupportedProviderFollowUp(c: EdgeDnsChecklist, provider: DnsProviderInfo): string[] {
  return [
    `Good news: ${provider.label} works with automatic HTTPS.`,
    "After the A/AAAA records above, you only need one API credential:",
    "",
    `  CADDY_DNS_PROVIDER=${provider.id}`,
    ...provider.envVars.map((v) => `  ${v}=`),
    "",
    provider.howto,
    "",
    "Caddy will create and remove the temporary TXT records for you.",
    "You should not need to paste TXT values by hand.",
  ];
}

export function formatEdgeDnsChecklist(c: EdgeDnsChecklist): string {
  const lines: string[] = [];
  lines.push("Public HTTPS setup for vivijure-local");
  lines.push(`  EDGE_PUBLIC_IP = ${c.publicIp}`);
  lines.push("");

  if (c.provider) {
    lines.push(...formatRequiredTrafficDns(c));
    lines.push("");
    if (c.nameservers.length) {
      lines.push(`Nameservers for ${c.apex}:`);
      for (const ns of c.nameservers) lines.push(`  ${ns}`);
      lines.push("");
    }
    lines.push(...formatSupportedProviderFollowUp(c, c.provider));
    lines.push("");
    lines.push("We will also set these for correct public URLs:");
    lines.push(`  PUBLIC_BASE_URL=https://${c.studioHost}`);
    lines.push(`  S3_PRESIGN_ENDPOINT=https://${c.minioHost}`);
    lines.push(`  MINIO_PUBLIC_DOMAIN=${c.minioHost}`);
    lines.push(`  CADDY_APP_HOST=${c.studioHost}`);
    lines.push(`  CADDY_MINIO_HOST=${c.minioHost}`);
    lines.push(`  CADDY_ACME_EMAIL=you@example.com`);
  } else {
    lines.push(...formatUnsupportedProviderBanner(c));
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const studioHost =
    process.env.CADDY_APP_HOST ?? process.env.STUDIO_HOST ?? "studio.example.com";
  const minioHost =
    process.env.CADDY_MINIO_HOST ?? process.env.MINIO_HOST ?? "s3.example.com";
  const checklist = await buildEdgeDnsChecklist({ studioHost, minioHost });
  console.log(formatEdgeDnsChecklist(checklist));

  for (const host of [studioHost, minioHost]) {
    try {
      const addrs = await resolve4(host);
      if (addrs.length && !addrs.includes(checklist.publicIp)) {
        console.log(
          `note: ${host} currently resolves to ${addrs.join(", ")} (checklist target is ${checklist.publicIp})`,
        );
      }
    } catch {
      /* not published yet */
    }
  }
}

const isMain =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]!);

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
