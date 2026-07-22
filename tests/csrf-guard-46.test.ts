import { describe, expect, it, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { isCrossSiteRequest } from "../src/auth-gate.js";
import type { ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";

// #46: the state-advancing GET routes accept the vivijure_token cookie (so the same-origin operator UI
// can poll), which makes them CSRF-triggerable from a cross-site page carrying the ambient cookie. A
// cross-site browser request (Sec-Fetch-Site: cross-site, unknown site, or ambient-cookie with no
// safe fetch-metadata / same-host Origin) is rejected 403; same-origin / same-site / user-initiated
// and Bearer-authenticated clients pass.

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir = "";

class EmptyModuleTransport implements ModuleTransport {
  resolve() {
    return null;
  }
  listBindings() {
    return [];
  }
}

function testPlatform(): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-csrf-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules: new EmptyModuleTransport(),
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

function get(
  app: ReturnType<typeof createApp>,
  path: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: { authorization: `Bearer ${SECRET}`, ...extra } }));
}

/** Cookie-auth GET — the CSRF-vulnerable ambient path the #46 guard protects. */
function getCookie(
  app: ReturnType<typeof createApp>,
  path: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      headers: { cookie: `vivijure_token=${encodeURIComponent(SECRET)}`, ...extra },
    }),
  );
}

afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("isCrossSiteRequest (#46)", () => {
  const req = (headers: Record<string, string>) => new Request("http://studio.local/api/x", { headers });
  const cookie = { cookie: "vivijure_token=x" };
  it("blocks an explicit Sec-Fetch-Site: cross-site when the ambient cookie is present", () => {
    expect(isCrossSiteRequest(req({ ...cookie, "sec-fetch-site": "cross-site" }))).toBe(true);
  });
  it("passes same-origin / same-site / none (the operator UI + address-bar hits)", () => {
    expect(isCrossSiteRequest(req({ ...cookie, "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(req({ ...cookie, "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isCrossSiteRequest(req({ ...cookie, "sec-fetch-site": "none" }))).toBe(false);
  });
  it("has no CSRF surface without the ambient cookie (Bearer / curl / Slate)", () => {
    expect(isCrossSiteRequest(req({}))).toBe(false);
    expect(isCrossSiteRequest(req({ authorization: "Bearer api-token-value" }))).toBe(false);
    expect(
      isCrossSiteRequest(req({ authorization: "Bearer api-token-value", "sec-fetch-site": "cross-site" })),
    ).toBe(false);
  });
  it("fails CLOSED for ambient-cookie requests with no fetch-metadata and no Origin", () => {
    expect(isCrossSiteRequest(req(cookie))).toBe(true);
  });
  it("does not let a decoy Bearer skip CSRF when the ambient cookie is present", () => {
    expect(
      isCrossSiteRequest(
        req({ authorization: "Bearer decoy", ...cookie, "sec-fetch-site": "cross-site" }),
      ),
    ).toBe(true);
    expect(isCrossSiteRequest(req({ authorization: "Bearer decoy", ...cookie }))).toBe(true);
  });
  it("blocks unknown Sec-Fetch-Site values on the cookie path", () => {
    expect(isCrossSiteRequest(req({ ...cookie, "sec-fetch-site": "nested-site" }))).toBe(true);
  });
  it("falls back to full same-origin Origin when Sec-Fetch-Site is absent on the cookie path", () => {
    expect(isCrossSiteRequest(req({ ...cookie, origin: "http://evil.example" }))).toBe(true);
    expect(isCrossSiteRequest(req({ ...cookie, origin: "http://studio.local" }))).toBe(false);
    expect(isCrossSiteRequest(req({ ...cookie, origin: "https://studio.local" }))).toBe(true); // scheme
    expect(isCrossSiteRequest(req({ ...cookie, origin: "http://studio.local:8080" }))).toBe(true); // port
    expect(isCrossSiteRequest(req({ ...cookie, origin: "not a url" }))).toBe(true);
  });
});

describe("state-advancing GET routes reject cross-site requests (#46)", () => {
  it("GET /api/storyboard/render/:jobId -> 403 cross-site cookie, 404 same-origin cookie", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const blocked = await getCookie(app, "/api/storyboard/render/film-does-not-exist", {
      "sec-fetch-site": "cross-site",
    });
    expect(blocked.status).toBe(403); // pre-fix: reached the handler -> 404
    const allowed = await getCookie(app, "/api/storyboard/render/runpod-legacy-id", {
      "sec-fetch-site": "same-origin",
    });
    expect(allowed.status).toBe(404); // guard passed; unknown/legacy job id
  });

  it("GET /api/render/film/:id -> 403 cross-site cookie, non-403 same-origin cookie", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const blocked = await getCookie(app, "/api/render/film/film-nope", { "sec-fetch-site": "cross-site" });
    expect(blocked.status).toBe(403);
    const allowed = await getCookie(app, "/api/render/film/not-a-film-id", { "sec-fetch-site": "same-origin" });
    expect(allowed.status).not.toBe(403); // guard passed (then 404 for a non-film id)
  });

  it("blocks ambient-cookie advances with no fetch-metadata (fail closed)", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await getCookie(app, "/api/storyboard/render/runpod-legacy-id");
    expect(res.status).toBe(403);
  });

  it("passes a Bearer client without fetch-metadata, even with Sec-Fetch-Site: cross-site", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const bare = await get(app, "/api/storyboard/render/runpod-legacy-id"); // no Sec-Fetch-Site
    expect(bare.status).toBe(404); // not blocked -- a real API client is unaffected
    const labeled = await get(app, "/api/storyboard/render/runpod-legacy-id", {
      "sec-fetch-site": "cross-site",
    });
    expect(labeled.status).toBe(404); // Bearer is not CSRF-forgeable
  });
});
