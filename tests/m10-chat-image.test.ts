import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { testSettingsHost } from "./test-host.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import type { Platform } from "../src/platform/types.js";

const SECRET = "a".repeat(32) + "b".repeat(32);

function auth() {
  return { authorization: `Bearer ${SECRET}` };
}

function makePlatform(root: string): Platform {
  const dbPath = join(root, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(root);
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: {} as Platform["presigner"],
    secrets: {} as Platform["secrets"],
    modules: { resolve: () => null, listBindings: () => [] },
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, PLANNER_AI_MOCK: "true" },
  };
}

describe("POST /api/chat image", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-chat-img-"));
    const platform = makePlatform(dir);
    app = createApp(
      testSettingsHost(platform, {
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CF_AIG_TOKEN: "tok",
        GATEWAY_ID: "vivijure",
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // /api/models is the FULL catalog as of cf#129 (projected planning rows + image rows), not the
  // image-only list it once was. This fixture installs NO modules, so the projection is empty and
  // every row here is legitimately an image row -- but the assertion is scoped to that fact rather
  // than claiming the route is image-only, which it no longer is. The full contract, including the
  // module-installed case, lives in tests/api-models-route.test.ts.
  it("GET /api/models returns the image rows when no plan.enhance module is installed", async () => {
    const res = await app.request("/api/models", { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ type: string }> };
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.every((m) => m.type === "image")).toBe(true);
  });

  it("rejects unknown image model id", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ model: "not-an-image-model", user_input: "a cat" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns output_artifact for image model (mocked Workers AI)", async () => {
    const b64 = Buffer.from("fakepng").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/ai/run/@cf/black-forest-labs/flux-2-klein-9b")) {
          return new Response(JSON.stringify({ result: { image: b64 } }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({
        model: "@cf/black-forest-labs/flux-2-klein-9b",
        user_input: "portrait of a pilot",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model_type: string;
      output_artifact: { key: string; type: string; mime: string };
    };
    expect(body.model_type).toBe("image");
    expect(body.output_artifact.type).toBe("image");
    expect(body.output_artifact.key).toMatch(/^out\//);
  });
});
