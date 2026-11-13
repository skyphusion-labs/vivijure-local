// local#271 acceptance 4: SDXL cast LoRA train on the local door must hand the card back from
// Ollama first, exactly as every render door does (unloadOllamaBeforeRender). Before this, a train
// submitted inside plan.enhance's keep_alive window contended with Ollama for the same GPU.
//
// SEAM: the REAL app and the REAL /api/cast/:id/train-lora route, with only globalThis.fetch
// stubbed so the Ollama unload (POST <OLLAMA_BASE_URL>/api/generate, keep_alive 0) is observable.
// The cast has no portrait, so core refuses with 400 AFTER the route runs, and no train job is
// submitted anywhere.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import type { ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
const OLLAMA = "http://ollama.test:11434";
let dir: string;
let calls: { url: string; body: string }[];
const realFetch = globalThis.fetch;

class EmptyModuleTransport implements ModuleTransport {
  resolve() {
    return null;
  }
  listBindings() {
    return [];
  }
}

function testPlatform(vars: Record<string, string>): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-train-271-"));
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
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, ...vars },
  };
}

function req(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function castId(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await req(app, "/api/cast", { name: "Wren" });
  expect(res.status).toBeLessThan(300);
  const j = (await res.json()) as { cast?: { id: string | number }; id?: string | number };
  const id = j.cast?.id ?? j.id;
  expect(id).toBeTruthy();
  return String(id);
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : "" });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("local#271 cast SDXL train hands the card back from Ollama first", () => {
  it("unloads the Ollama model (keep_alive 0) before the train handler runs", async () => {
    const app = createApp(
      testSettingsHost(
        testPlatform({ OLLAMA_BASE_URL: OLLAMA, OLLAMA_PLAN_MODEL: "qwen3:14b", LOCAL_BACKEND_URL: "http://door.test:8000" }),
      ),
    );
    const id = await castId(app);
    calls = [];
    const res = await req(app, `/api/cast/${id}/train-lora`, {});
    // No portrait: core refuses, so nothing was submitted to the door.
    expect(res.status).toBe(400);
    const unload = calls.filter((c) => c.url === `${OLLAMA}/api/generate`);
    expect(unload).toHaveLength(1);
    expect(JSON.parse(unload[0].body)).toMatchObject({ keep_alive: 0 });
    expect(calls.some((c) => c.url.startsWith("http://door.test"))).toBe(false);
  });

  it("asks nothing of Ollama when Ollama is not configured", async () => {
    const app = createApp(testSettingsHost(testPlatform({ LOCAL_BACKEND_URL: "http://door.test:8000" })));
    const id = await castId(app);
    calls = [];
    const res = await req(app, `/api/cast/${id}/train-lora`, {});
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
