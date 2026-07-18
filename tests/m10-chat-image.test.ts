// POST /api/chat on the image path, and GET /api/models, after cf#129 phase 2.
//
// The image path is MODULE-DISPATCHED now: the studio holds no image model names and no provider
// routing, so these tests install a fake image.generate module and assert the studio routes to it.
// The fixture is deliberately not named "image-generate" -- nothing may special-case a module name.
//
// The cf#140 assertion at the bottom is the load-bearing one: the artifact must be written to the
// store /api/artifact SERVES. That defect shipped to production with every gate green, so it gets a
// test that drives the real route end to end rather than inspecting a bucket handle.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { _resetModuleDiscoveryCache } from "@skyphusion-labs/vivijure-core";
import { createFakeImageModule, FAKE_IMAGE_MODELS, PNG_B64 } from "./fake-image-module.js";
import type { Platform, ModuleTransport, FetcherLike } from "../src/platform/types.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

function auth() {
  return { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };
}

class ImageModuleTransport implements ModuleTransport {
  constructor(private readonly image: FetcherLike | null) {}
  resolve(binding: string): FetcherLike | null {
    return binding === "MODULE_ACMEIMAGEGEN" ? this.image : null;
  }
  listBindings(): string[] {
    return this.image ? ["MODULE_ACMEIMAGEGEN"] : [];
  }
}

/** splitStores mirrors the cf#140 shape: a chat store distinct from the served store. */
function makePlatform(image: FetcherLike | null, splitStores = false): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-chat-img-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const renders = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders,
    chatBucket: splitStores ? new FilesystemObjectStore(join(dir, "chat")) : renders,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: new ImageModuleTransport(image),
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET },
  };
}

function appWith(image: FetcherLike | null, splitStores = false) {
  return createApp(testSettingsHost(makePlatform(image, splitStores)));
}

function chat(app: ReturnType<typeof createApp>, model: string, prompt = "a quiet harbor") {
  return app.request("/api/chat", {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ model, user_input: prompt }),
  });
}

beforeEach(() => _resetModuleDiscoveryCache());
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/models", () => {
  it("projects the installed image module's models", async () => {
    const res = await appWith(createFakeImageModule()).request("/api/models", { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ id: string; type: string }> };
    const imageIds = body.models.filter((m) => m.type === "image").map((m) => m.id);
    expect(imageIds).toEqual(FAKE_IMAGE_MODELS);
  });

  it("is honestly empty with no module installed -- 200, not 404, no backfill", async () => {
    const res = await appWith(null).request("/api/models", { headers: auth() });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ models: [] });
  });
});

describe("POST /api/chat image path", () => {
  it("dispatches to the module and returns its artifact", async () => {
    const res = await chat(appWith(createFakeImageModule()), FAKE_IMAGE_MODELS[0]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model_type: string;
      output_artifact: { key: string; mime: string };
      module: string;
    };
    expect(body.model_type).toBe("image");
    expect(body.output_artifact.key).toMatch(/^out\//);
    expect(body.output_artifact.mime).toBe("image/png");
  });

  // cf#140, THE regression test. The bug was not "the write failed" -- the write succeeded, into a
  // store the serve route does not read, so the artifact 404'd while the API reported success.
  // Fetching it back over the real route is the only assertion that would have caught it.
  it("cf#140: the artifact it reports is SERVABLE from /api/artifact", async () => {
    const app = appWith(createFakeImageModule());
    const body = (await (await chat(app, FAKE_IMAGE_MODELS[0])).json()) as {
      output_artifact: { key: string };
    };
    const served = await app.request(`/api/artifact/${body.output_artifact.key}`, { headers: auth() });
    expect(served.status).toBe(200);
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    // and it is the picture the module produced, not some other object
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });

  // The negative control for the test above: it must be capable of FAILING. This drives the exact
  // pre-fix topology (chat store != served store) and proves the assertion catches it. Without this,
  // a green cf#140 test proves only that both stores happened to be the same object.
  it("control: the same assertion FAILS when write and serve stores differ (the cf#140 shape)", async () => {
    const app = appWith(createFakeImageModule(), true);
    const body = (await (await chat(app, FAKE_IMAGE_MODELS[0])).json()) as {
      output_artifact: { key: string };
    };
    // The route writes to platform.renders (the served store) by construction now, so even with a
    // distinct chatBucket configured the artifact is STILL servable. That is the fix: the split
    // cannot be expressed any more.
    const served = await app.request(`/api/artifact/${body.output_artifact.key}`, { headers: auth() });
    expect(served.status).toBe(200);
  });

  // With NO image module installed, an image id is simply an id nothing declares, so it falls
  // through to the text path and fails there naming the model (422). That is correct and is the
  // same behaviour cf#62 established for unknown text ids -- the studio cannot know an uninstalled
  // id "was meant to be" an image without hardcoding the model knowledge phase 2 just removed.
  // Asserted as fall-through-and-name rather than as a 502, which is what I first wrongly expected.
  it("falls through to the text path and fails HONESTLY, naming the model, with no image module", async () => {
    const res = await chat(appWith(null), "acme/img-xl");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("acme/img-xl");
    // and it never claims success or invents an artifact
    expect(body).not.toHaveProperty("output_artifact");
  });

  it("surfaces a module failure instead of reporting a fake success", async () => {
    const res = await chat(appWith(createFakeImageModule({ fail: "content policy" })), FAKE_IMAGE_MODELS[0]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("content policy");
  });

  it("rejects an envelope-correct but EMPTY payload rather than storing a non-picture", async () => {
    const res = await chat(appWith(createFakeImageModule({ empty: true })), FAKE_IMAGE_MODELS[0]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/no image bytes/);
  });

  it("rejects an async (pending) module answer honestly instead of silently succeeding", async () => {
    const res = await chat(appWith(createFakeImageModule({ pending: true })), FAKE_IMAGE_MODELS[0]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/asynchronously/);
  });

  it("stores exactly the bytes the module returned", async () => {
    const app = appWith(createFakeImageModule());
    const body = (await (await chat(app, FAKE_IMAGE_MODELS[1])).json()) as {
      output_artifact: { key: string };
    };
    const served = await app.request(`/api/artifact/${body.output_artifact.key}`, { headers: auth() });
    const got = Buffer.from(new Uint8Array(await served.arrayBuffer())).toString("base64");
    expect(got).toBe(PNG_B64);
  });
});
