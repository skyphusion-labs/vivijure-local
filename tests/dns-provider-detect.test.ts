import { describe, expect, it } from "vitest";
import {
  apexFromHostname,
  detectDnsProvider,
} from "../scripts/dns-provider-detect.js";
import {
  formatEdgeDnsChecklist,
  formatRequiredAcmeTxtDns,
  type EdgeDnsChecklist,
} from "../scripts/print-edge-dns.js";
import { renderSitesCaddyfile } from "../scripts/render-caddy-sites.js";

describe("apexFromHostname", () => {
  it("strips one label for normal domains", () => {
    expect(apexFromHostname("studio.example.com")).toBe("example.com");
    expect(apexFromHostname("s3.example.com")).toBe("example.com");
  });

  it("keeps co.uk style apexes", () => {
    expect(apexFromHostname("studio.myapp.co.uk")).toBe("myapp.co.uk");
  });
});

describe("detectDnsProvider", () => {
  it("detects Cloudflare", () => {
    const p = detectDnsProvider(["ada.ns.cloudflare.com.", "bob.ns.cloudflare.com."]);
    expect(p?.id).toBe("cloudflare");
    expect(p?.envVars).toContain("CF_DNS_TOKEN");
  });

  it("detects Route 53", () => {
    const p = detectDnsProvider(["ns-123.awsdns-12.com."]);
    expect(p?.id).toBe("route53");
  });

  it("detects DigitalOcean", () => {
    const p = detectDnsProvider(["ns1.digitalocean.com."]);
    expect(p?.id).toBe("digitalocean");
  });

  it("detects Hetzner", () => {
    const p = detectDnsProvider(["hydrogen.ns.hetzner.com."]);
    expect(p?.id).toBe("hetzner");
  });

  it("returns null for unknown", () => {
    expect(detectDnsProvider(["ns1.hover.com."])).toBeNull();
  });
});

describe("unsupported DNS install message", () => {
  const manual: EdgeDnsChecklist = {
    studioHost: "studio.example.com",
    minioHost: "s3.example.com",
    publicIp: "203.0.113.10",
    apex: "example.com",
    nameservers: ["ns1.hover.com."],
    provider: null,
  };

  it("states automatic SSL is not available and leads with easiest fix", () => {
    const body = formatEdgeDnsChecklist(manual);
    expect(body).toMatch(/not set up for automatic SSL/i);
    expect(body).toMatch(/EASIEST/i);
    expect(body).toMatch(/Cloudflare free/i);
    expect(body).toMatch(/STAY HERE/i);
  });

  it("lists A\/AAAA traffic records and ACME TXT names", () => {
    const body = formatEdgeDnsChecklist(manual);
    expect(body).toContain("A/AAAA  studio.example.com");
    expect(body).toContain("A/AAAA  *.s3.example.com");
    expect(body).toContain("TXT   _acme-challenge.studio.example.com");
    expect(body).toContain("TXT   _acme-challenge.s3.example.com");
    expect(body).toMatch(/we will show the exact value/i);
    expect(body).toContain("npm run install:edge");
  });

  it("explains TXT values appear at issue time", () => {
    const txt = formatRequiredAcmeTxtDns(manual).join("\n");
    expect(txt).toMatch(/wildcard/i);
    expect(txt).toContain("_acme-challenge.s3.example.com");
  });
});

describe("renderSitesCaddyfile", () => {
  it("emits cloudflare tls for MinIO wildcard", () => {
    const body = renderSitesCaddyfile({
      appHost: "studio.example.com",
      minioHost: "s3.example.com",
      provider: "cloudflare",
      tlsMode: "dns",
    });
    expect(body).toContain("studio.example.com");
    expect(body).toContain("*.s3.example.com");
    expect(body).toContain("dns cloudflare");
    expect(body).toContain("reverse_proxy studio:8790");
    expect(body).toContain("reverse_proxy minio:9000");
  });

  it("emits file tls when asked", () => {
    const body = renderSitesCaddyfile({
      appHost: "studio.example.com",
      minioHost: "s3.example.com",
      provider: "",
      tlsMode: "files",
    });
    expect(body).toContain("tls /certs/minio.pem");
  });
});
