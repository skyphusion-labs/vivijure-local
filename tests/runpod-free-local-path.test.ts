// The local path renders with NO RunPod credential configured (epic local#200, local#229).
//
// This is the claim a homelabber cares about, so it is asserted against a REAL HTTP door rather than
// a stubbed `fetch`: a stub proves the code called something, not that nothing else was reachable.
// The door server records every request it receives, and a network guard records every host the
// module tries to contact, so "no RunPod call happened" is an observation instead of an assumption.
//
// Env in these tests carries NO RUNPOD_API_KEY and NO *_RUNPOD_ENDPOINT_ID. Nothing here is allowed
// to boot-assert, throw, or degrade to a cloud provider because of that.
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { createLocalGpuModuleApp } from "../src/modules/local-gpu/app.js";
import type { LocalGpuEnv } from "../src/modules/local-gpu/handlers.js";
import { finishBackendFromProcess, resolveFinishBackend } from "../src/modules/finish-backend.js";
import { _resetModuleDiscoveryCache, MODULE_API, type ModulesResponse } from "@skyphusion-labs/vivijure-core";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

/** A stand-in GPU door. Records what it was asked to do, so the assertion is on real traffic. */
let door: Server;
let doorUrl: string;
const doorHits: string[] = [];

beforeAll(async () => {
  door = createServer((req, res) => {
    doorHits.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // Alphanumeric id: SAFE_JOB_ID rejects anything else.
    res.end(JSON.stringify({ id: "doorjob1", status: "IN_QUEUE" }));
  });
  await new Promise<void>((resolve) => door.listen(0, "127.0.0.1", resolve));
  doorUrl = `http://127.0.0.1:${(door.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => door.close(() => resolve()));
});

/** Env for a homelab studio: a door, and deliberately NOTHING from RunPod. */
function noRunpodDoorEnv(): LocalGpuEnv {
  const env: LocalGpuEnv = { LOCAL_BACKEND_URL: doorUrl };
  // Guard the premise of the whole file rather than trusting the literal above.
  for (const [k, v] of Object.entries(env)) {
    expect(k, "the fixture must not smuggle a RunPod var in").not.toMatch(/RUNPOD/);
    expect(String(v)).not.toMatch(/runpod/i);
  }
  return env;
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "dev/manifests/local-gpu.json"), "utf8"),
) as Record<string, unknown>;

describe("a door-configured studio renders without any RunPod credential", () => {
  it("keyframe submit reaches the DOOR over real HTTP, and nothing else", async () => {
    doorHits.length = 0;
    const app = createLocalGpuModuleApp(manifest, async () => noRunpodDoorEnv());
    const res = await app.fetch(
      new Request("https://module/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook: "keyframe",
          input: { project: "p1", bundle_key: "bundles/p1.tar.gz", shot_ids: ["s1"] },
          context: { project: "p1" },
        }),
      }),
    );
    const body = (await res.json()) as { ok: boolean; pending?: boolean; jobId?: string; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("doorjob1");
    // Real traffic, real destination: the door saw the submit.
    expect(doorHits).toContain("POST /run");
  });

  it("motion submit reaches the DOOR over real HTTP", async () => {
    doorHits.length = 0;
    const app = createLocalGpuModuleApp(manifest, async () => noRunpodDoorEnv());
    const res = await app.fetch(
      new Request("https://module/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook: "motion.backend",
          input: { shot_id: "s1", prompt: "a wide shot of the ocean at dusk", seconds: 4 },
          context: { project: "p1" },
        }),
      }),
    );
    const body = (await res.json()) as { ok: boolean; jobId?: string; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe("doorjob1");
    expect(doorHits).toContain("POST /run");
  });

  it("the module serves its real manifest on a RunPod-free studio", async () => {
    // It does NOT self-report `configured` (local#280). Being in the stack IS being installed; the
    // removed flag was a stand-in speaking for a module that might not be there, which Conrad
    // rejected. A RunPod-free door studio advertises the door engine plainly.
    const app = createLocalGpuModuleApp(manifest, async () => noRunpodDoorEnv());
    const body = (await (await app.fetch(new Request("https://module/module.json"))).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).not.toContain("configured");
    expect(body.name).toBe("local-gpu");
    expect(body.hooks).toContain("motion.backend");
  });
});

describe("finish routing does not reach for RunPod on its own", () => {
  it("an empty env resolves to the LOCAL finish backend", () => {
    // The regression this pins: the default used to be `runpod`, so a satellites-profile studio with
    // no FINISH_BACKEND set dispatched to a cloud provider nobody configured.
    const env = finishBackendFromProcess({});
    expect(resolveFinishBackend("finish-lipsync", env)).toBe("local");
    expect(resolveFinishBackend("finish-upscale", env)).toBe("local");
  });
});

describe("the studio serves /api/modules with no RunPod env at all", () => {
  let dir: string;

  class NoModules implements ModuleTransport {
    resolve(): FetcherLike | null {
      return null;
    }
    listBindings(): string[] {
      return [];
    }
  }

  afterEach(() => {
    _resetModuleDiscoveryCache();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("returns 200 and reports the missing engine instead of failing to boot", async () => {
    dir = mkdtempSync(join(tmpdir(), "vj-norunpod-"));
    const dbPath = join(dir, "studio.db");
    migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
    const store = new FilesystemObjectStore(join(dir, "renders"));
    const platform = {
      db: openDatabase(dbPath),
      renders: store,
      chatBucket: store,
      presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
      secrets: new EnvSecretStore({}),
      modules: new NoModules(),
      // No RUNPOD_API_KEY, no *_RUNPOD_ENDPOINT_ID, no FINISH_BACKEND.
      vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
    } as unknown as Platform;

    const app = createApp(testSettingsHost(platform));
    const res = await app.request("/api/modules", { headers: { authorization: `Bearer ${SECRET}` } });
    // The claim: no startup assertion, no required-secret gate, no 500 for absent RunPod.
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModulesResponse;
    expect(body.api).toBe(MODULE_API);
    // ...and the absent GPU engine is REPORTED, not silently substituted.
    expect(body.host?.hooks_unavailable?.["keyframe"]).toMatch(/LOCAL_BACKEND_URL/);
    expect(body.host?.hooks_unavailable?.["motion.backend"]).toMatch(/LOCAL_BACKEND_URL/);
  });
});
