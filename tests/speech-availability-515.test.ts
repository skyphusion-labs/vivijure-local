// local#515: the parity half of vivijure-cf#904. `speech` is in core's catalog, and GET
// /api/modules reports host.hooks_unavailable.speech whenever no DISCOVERED module serves it. The
// entry is derived, so it clears itself when a module serving `speech` is discovered.

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { _resetModuleDiscoveryCache, type ModulesResponse, type RegisteredModule } from "@skyphusion-labs/vivijure-core";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { SPEECH_UNAVAILABLE_REASON, speechHooksUnavailable } from "../src/speech-availability.js";

const ROOT = join(import.meta.dirname, "..");
const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

class NoModules implements ModuleTransport {
  resolve(): FetcherLike | null {
    return null;
  }
  listBindings(): string[] {
    return [];
  }
}

/** A module serving `speech` and nothing else. Not named speech-upscale: the gate asks which hooks
 *  are SERVED, never which module serves them. */
class SpeechModule implements ModuleTransport {
  resolve(): FetcherLike {
    const manifest = {
      name: "acme-speech",
      version: "1.0.0",
      api: "vivijure-module/2",
      hooks: ["speech"],
      provides: [{ id: "acme-speech", label: "ACME Speech" }],
      binding: "MODULE_ACMESPEECH",
    };
    return {
      fetch: async (input: string | URL) =>
        new URL(String(input)).pathname === "/module.json"
          ? new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } })
          : new Response("{}", { status: 404 }),
    } as FetcherLike;
  }
  listBindings(): string[] {
    return ["MODULE_ACMESPEECH"];
  }
}

async function modulesBody(modules: ModuleTransport): Promise<ModulesResponse & { catalog: { name: string }[] }> {
  dir = mkdtempSync(join(tmpdir(), "vj-515-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(ROOT, "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  const platform = {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules,
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  } as unknown as Platform;
  const app = createApp(testSettingsHost(platform));
  const res = await app.request("/api/modules", { headers: { authorization: `Bearer ${SECRET}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as ModulesResponse & { catalog: { name: string }[] };
}

beforeEach(() => _resetModuleDiscoveryCache());
afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("local#515: derived from what is discovered", () => {
  it("nothing serves speech: reported, with the reason", () => {
    expect(speechHooksUnavailable([])).toEqual({ speech: SPEECH_UNAVAILABLE_REASON });
  });

  it("a module serving speech is discovered: the key is gone", () => {
    const m = { name: "acme-speech", hooks: ["speech"] } as unknown as RegisteredModule;
    expect(speechHooksUnavailable([m])).toEqual({});
  });
});

describe("local#515: GET /api/modules says so", () => {
  it("a bare studio reports speech, and the catalog still lists it", async () => {
    const body = await modulesBody(new NoModules());
    // CONTROL: this studio serves nothing for speech, which is the condition under test.
    expect(body.hooks.speech).toBeUndefined();
    expect(body.catalog.map((h) => h.name)).toContain("speech");
    expect(body.host?.hooks_unavailable?.speech).toBe(SPEECH_UNAVAILABLE_REASON);
  });

  it("a studio with a speech module discovered reports nothing for speech", async () => {
    const body = await modulesBody(new SpeechModule());
    // CONTROL: discovery really did find the module, so the absence below is a real observation.
    expect(body.hooks.speech).toEqual(["acme-speech"]);
    expect(body.host?.hooks_unavailable?.speech).toBeUndefined();
  });
});

describe("local#515: the reason names knobs that exist", () => {
  // The reason is written for the operator (local#226), so a knob it names must be one this repo
  // actually reads. A renamed variable or service would otherwise leave advice pointing at nothing.
  it("MODULE_SPEECH_UPSCALE_URL and LOCAL_FINISH_SPEECH_URL are real settings", () => {
    const catalog = readFileSync(join(ROOT, "src", "platform-secrets-catalog.ts"), "utf8");
    for (const key of ["MODULE_SPEECH_UPSCALE_URL", "LOCAL_FINISH_SPEECH_URL"]) {
      expect(SPEECH_UNAVAILABLE_REASON).toContain(key);
      expect(catalog).toContain(`key: "${key}"`);
    }
  });

  it("module-speech-upscale is a compose service in the satellites profile, on port 9143", () => {
    const compose = readFileSync(join(ROOT, "compose.yaml"), "utf8");
    const svc = /\n  module-speech-upscale:\n([\s\S]*?)\n  [a-z]/.exec(compose);
    expect(svc, "service block").not.toBeNull();
    expect(svc![1]).toMatch(/profiles: \[[^\]]*\bsatellites\b/);
    expect(svc![1]).toContain('"9143", "speech-upscale"');
    expect(SPEECH_UNAVAILABLE_REASON).toContain("http://module-speech-upscale:9143");
  });
});
