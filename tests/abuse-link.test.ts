// control-plane#130 TWIN: the abuse-report link on the self-host panel (local#242).
//
// WHY THIS FILE EXISTS AT ALL, since the panel bytes are shared: public/ is synced verbatim from
// vivijure-cf and guarded by scripts/upstream-public-parity.sh, so the RENDERER needs no second
// test here. What is genuinely this repo is the HOST half -- the projection of an operator var into
// host.abuse_report_url through this panel own platform.vars, and the Settings catalog entry that
// makes the knob findable by the person who can turn it. Those are what these tests cover.
//
// THE PARITY BLOCK BELOW IS NOT CEREMONY. This IS the self-host bundle the hosted rule was written
// to protect: our abuse address must never ship inside the bundle a self-hoster installs. On the
// hosted side that guard asserts a promise about someone else. Here it asserts a property of the
// artifact a stranger actually downloads, which is the stronger place to assert it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { abuseReportUrl } from "../src/abuse-contact.js";
import { PLATFORM_SECRET_FIELDS } from "../src/platform-secrets-catalog.js";
import type { Platform } from "../src/platform/types.js";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

const SECRET = "a".repeat(32) + "b".repeat(32);
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

function testPlatform(vars: Record<string, string> = {}): Platform {
  const dir = mkdtempSync(join(tmpdir(), "vj-abuse-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, ...vars },
  };
}

async function hostOf(vars: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const app = createApp(testSettingsHost(testPlatform(vars)));
  const res = await app.request("/api/modules", { headers: { authorization: `Bearer ${SECRET}` } });
  const body = (await res.json()) as { host?: Record<string, unknown> };
  return body.host ?? {};
}

beforeEach(() => {
  _resetModuleDiscoveryCache();
});

describe("abuseReportUrl (the host side: what this studio advertises about itself)", () => {
  it("advertises nothing when the operator has published no address", () => {
    expect(abuseReportUrl({})).toBeNull();
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "   " })).toBeNull();
  });

  it("passes through an operator address, http or https", () => {
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "https://example.org/report" })).toBe("https://example.org/report");
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "http://192.0.2.9:8080/report" })).toBe("http://192.0.2.9:8080/report");
  });

  it("REFUSES a scheme that is not http(s), and says so out loud", () => {
    // The value reaches an href, so this is a DOM boundary rather than tidiness. Loud because on
    // THIS panel the operator reading the log is the person who can fix it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "javascript:alert(1)" })).toBeNull();
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "data:text/html,x" })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("REFUSES a relative path, which would resolve against the studio origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(abuseReportUrl({ ABUSE_REPORT_URL: "/report-abuse" })).toBeNull();
    warn.mockRestore();
  });
});

describe("the route carries the field (local#242)", () => {
  it("omits it entirely when the operator published nothing, which is the default install", async () => {
    const host = await hostOf();
    expect("abuse_report_url" in host).toBe(false);
    // CONTROL: the payload really was read, so the absence above is not an empty response.
    expect(host).toHaveProperty("dispatch");
  });

  it("carries the operator address when one is set", async () => {
    const host = await hostOf({ ABUSE_REPORT_URL: "https://example.org/report" });
    expect(host.abuse_report_url).toBe("https://example.org/report");
  });

  it("omits a refused address rather than advertising a dangerous link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = await hostOf({ ABUSE_REPORT_URL: "javascript:alert(1)" });
    expect("abuse_report_url" in host).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the knob is findable by the person who can turn it", () => {
  it("is in the Settings catalog, which is where THIS panel puts operator vars", () => {
    // The BIAS half of parity. vivijure-cf has no equivalent, because a hosted tenant cannot set
    // this and must not be told to; here the reader IS the operator, so the knob is theirs.
    const entry = PLATFORM_SECRET_FIELDS.find((e) => e.key === "ABUSE_REPORT_URL");
    expect(entry, "ABUSE_REPORT_URL missing from the settings catalog").toBeDefined();
    expect(entry?.sensitive, "an abuse contact is published on purpose, not a secret").toBe(false);
  });
});

describe("PARITY: nothing about anyone else abuse channel is baked into this bundle", () => {
  const assets = readdirSync(PUBLIC_DIR).filter((f) => /\.(js|html|css)$/.test(f));
  const read = (f: string) => readFileSync(join(PUBLIC_DIR, f), "utf8");

  it("reads a real, non-trivial set of assets (the control for the assertion below)", () => {
    // Without this, a glob that matched nothing would make the assertion below vacuously true.
    expect(assets.length).toBeGreaterThan(20);
    expect(assets).toContain("abuse-link.js");
  });

  it("no shipped asset carries the hosted abuse address or report page", () => {
    const offenders = assets.filter((f) => {
      const text = read(f);
      return /abuse@skyphusion\.org/.test(text) || /vivijure\.com\/report-abuse/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("the renderer has no fallback address to fall back TO", () => {
    // A default would look harmless and would be the whole defect: every install would start
    // advertising somebody else the moment a fetch failed or a field went missing.
    const src = read("abuse-link.js");
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).toMatch(/abuse_report_url|abuseLink/);
  });
});
