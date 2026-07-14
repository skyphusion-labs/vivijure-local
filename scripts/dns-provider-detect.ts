/**
 * Map DNS NS hostnames to a supported Caddy DNS-01 provider id + env vars.
 * Used by print-edge-dns / install:edge. Unknown providers return null (manual path).
 */

export type DnsProviderId =
  | "cloudflare"
  | "route53"
  | "digitalocean"
  | "googleclouddns"
  | "hetzner"
  | "ovh";

export interface DnsProviderInfo {
  id: DnsProviderId;
  label: string;
  /** Env vars the operator must set for Caddy DNS-01 */
  envVars: string[];
  /** Short blurb for the checklist (plain language) */
  howto: string;
}

const PROVIDERS: Array<{ match: RegExp; info: DnsProviderInfo }> = [
  {
    match: /\.ns\.cloudflare\.com\.?$/i,
    info: {
      id: "cloudflare",
      label: "Cloudflare",
      envVars: ["CF_DNS_TOKEN"],
      howto:
        "In Cloudflare, create an API token with Zone DNS Edit on only your zone. Put it in CF_DNS_TOKEN.",
    },
  },
  {
    match: /\.awsdns-/i,
    info: {
      id: "route53",
      label: "Amazon Route 53",
      envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_HOSTED_ZONE_ID"],
      howto:
        "Create an IAM user that can change DNS in your hosted zone. Put the access key, secret, and hosted zone id in .env.",
    },
  },
  {
    match: /\.digitalocean\.com\.?$/i,
    info: {
      id: "digitalocean",
      label: "DigitalOcean",
      envVars: ["DO_AUTH_TOKEN"],
      howto:
        "In DigitalOcean, create a personal access token with write access to domains. Put it in DO_AUTH_TOKEN.",
    },
  },
  {
    match: /\.googledomains\.com\.?$/i,
    info: {
      id: "googleclouddns",
      label: "Google Cloud DNS",
      envVars: ["GCP_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"],
      howto:
        "Use a Google Cloud service account that can edit Cloud DNS. Put GCP_PROJECT and the path to the JSON key (GOOGLE_APPLICATION_CREDENTIALS) in .env.",
    },
  },
  {
    match: /\.ns\.cloud\.google\.?$/i,
    info: {
      id: "googleclouddns",
      label: "Google Cloud DNS",
      envVars: ["GCP_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"],
      howto:
        "Use a Google Cloud service account that can edit Cloud DNS. Put GCP_PROJECT and the path to the JSON key (GOOGLE_APPLICATION_CREDENTIALS) in .env.",
    },
  },
  {
    match: /\.ns\.hetzner\.com\.?$/i,
    info: {
      id: "hetzner",
      label: "Hetzner DNS",
      envVars: ["HETZNER_API_TOKEN"],
      howto: "In Hetzner DNS, create an API token. Put it in HETZNER_API_TOKEN.",
    },
  },
  {
    match: /\.ovh\./i,
    info: {
      id: "ovh",
      label: "OVH",
      envVars: ["OVH_ENDPOINT", "OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY"],
      howto: "Create OVH API credentials for your domain zone and put the four OVH_* values in .env.",
    },
  },
];

/** Pick a provider from a list of NS hostnames (trailing dots ok). */
export function detectDnsProvider(nameservers: string[]): DnsProviderInfo | null {
  for (const ns of nameservers) {
    const host = ns.trim().toLowerCase();
    for (const row of PROVIDERS) {
      if (row.match.test(host)) return row.info;
    }
  }
  return null;
}

/** Apex zone guess: studio.example.com -> example.com; a.b.co.uk kept as last three labels. */
export function apexFromHostname(hostname: string): string {
  const parts = hostname.replace(/\.$/, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevel = new Set(["co.uk", "com.au", "co.nz", "com.br", "co.jp"]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevel.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return lastTwo;
}
