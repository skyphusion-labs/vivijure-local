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
// cross-site browser request (Sec-Fetch-Site: cross-site, or an absent header with a cross-origin
// Origin) is now rejected 403; same-origin / same-site / user-initiated / non-browser requests pass.

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

function get(app: ReturnType<typeof createApp>, path: string, extra: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: { authorization: `Bearer ${SECRET}`, ...extra } }));
}

afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("isCrossSiteRequest (#46)", () => {
  const req = (headers: Record<string, string>) => new Request("http://studio.local/api/x", { headers });
  it("blocks an explicit Sec-Fetch-Site: cross-site", () => {
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });
  it("passes same-origin / same-site / none (the operator UI + address-bar hits)", () => {
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "none" }))).toBe(false);
  });
  it("fails OPEN when no fetch-metadata and no Origin (a Bearer/curl/non-browser client)", () => {
    expect(isCrossSiteRequest(req({}))).toBe(false);
  });
  it("falls back to Origin when Sec-Fetch-Site is absent", () => {
    expect(isCrossSiteRequest(req({ origin: "http://evil.example" }))).toBe(true); // cross-origin
    expect(isCrossSiteRequest(req({ origin: "http://studio.local" }))).toBe(false); // same-origin
    expect(isCrossSiteRequest(req({ origin: "not a url" }))).toBe(true); // malformed -> suspicious
  });
});

describe("state-advancing GET routes reject cross-site requests (#46)", () => {
  it("GET /api/storyboard/render/:jobId -> 403 cross-site, 404 same-origin (guard runs before the job lookup)", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const blocked = await get(app, "/api/storyboard/render/film-does-not-exist", { "sec-fetch-site": "cross-site" });
    expect(blocked.status).toBe(403); // pre-fix: reached the handler -> 404
    const allowed = await get(app, "/api/storyboard/render/runpod-legacy-id", { "sec-fetch-site": "same-origin" });
    expect(allowed.status).toBe(404); // guard passed; unknown/legacy job id
  });

  it("GET /api/render/film/:id -> 403 cross-site, non-403 same-origin", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const blocked = await get(app, "/api/render/film/film-nope", { "sec-fetch-site": "cross-site" });
    expect(blocked.status).toBe(403);
    const allowed = await get(app, "/api/render/film/not-a-film-id", { "sec-fetch-site": "same-origin" });
    expect(allowed.status).not.toBe(403); // guard passed (then 404 for a non-film id)
  });

  it("passes a cross-site-shaped request that authenticates by Bearer without fetch-metadata (non-browser)", async () => {
    const app = createApp(testSettingsHost(testPlatform()));
    const res = await get(app, "/api/storyboard/render/runpod-legacy-id"); // no Sec-Fetch-Site header
    expect(res.status).toBe(404); // not blocked -- a real API client is unaffected
  });
});
