import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAST_IMAGE_ANSWER_TIMEOUT_MS,
  CAST_IMAGE_GENERATE_TIMEOUT_MS,
  CastImageDoorUnreachable,
  generateCastImageLocal,
} from "../src/modules/chain/cast-image-local.js";
import { SELF_HOST_MODEL_REVISIONS } from "../src/modules/chain/cast-image-model-policy.js";
import { invokeCastImage, pollCastImage } from "../src/modules/chain/handlers.js";
import type { ChainModuleEnv } from "../src/modules/chain/chain-env.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { resetDoorCursorsForTests } from "../src/modules/door-pool.js";

// local#490. REAL SOCKETS, NO FETCH MOCK: the defect is a property of how fetch behaves against a
// door that accepts and never answers, so a mocked fetch would encode the very assumption under
// test. Each door here is a node:http server on 127.0.0.1 with a chosen behaviour.

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const REVISION = SELF_HOST_MODEL_REVISIONS["black-forest-labs/FLUX.2-klein-4B"];

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function door(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const { port } = srv.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        srv.closeAllConnections();
        srv.close(() => r());
      }),
  };
}

const okImage = (res: http.ServerResponse) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ image: PNG_B64, mime: "image/png", revision: REVISION }));
};

/** Never writes a response. The measured shape: the socket connects, the HTTP answer never comes. */
const silent: Handler = () => {};

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers) await c();
  closers = [];
});
async function up(handler: Handler): Promise<string> {
  const d = await door(handler);
  closers.push(d.close);
  return d.url;
}

describe("local#490 -- a door that accepts and never answers fails fast, named", () => {
  it("the answer bound is short and far below the generation budget", () => {
    expect(CAST_IMAGE_ANSWER_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(CAST_IMAGE_ANSWER_TIMEOUT_MS * 10).toBeLessThan(CAST_IMAGE_GENERATE_TIMEOUT_MS);
  });

  it("a silent door rejects within the answer bound, naming the door, as unreachable", async () => {
    const url = await up(silent);
    const t0 = Date.now();
    const err = await generateCastImageLocal(url, "a portrait", [], { answerTimeoutMs: 300 }).then(
      () => null,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - t0;
    expect(err).toBeInstanceOf(CastImageDoorUnreachable);
    expect((err as Error).message).toContain(url);
    expect((err as Error).message).toMatch(/no answer to GET \/health within 300ms/);
    // Bounded by the answer timeout, not the 600s generation budget. Generous slack for CI.
    expect(elapsed).toBeLessThan(3_000);
  });

  it("a refused door is unreachable too, at once", async () => {
    const url = await up(silent);
    await closers.pop()!(); // the port is now closed: ECONNREFUSED
    await expect(generateCastImageLocal(url, "a portrait", [], { answerTimeoutMs: 300 })).rejects.toBeInstanceOf(
      CastImageDoorUnreachable,
    );
  });

  it("ANY HTTP answer counts: a door whose /health is a 404 still generates", async () => {
    const url = await up((req, res) => {
      if (req.url === "/health") {
        res.writeHead(404);
        res.end();
        return;
      }
      okImage(res);
    });
    const img = await generateCastImageLocal(url, "a portrait", [], { answerTimeoutMs: 300 });
    expect(img.bytes.length).toBeGreaterThan(0);
  });

  it("generation itself is NOT held to the answer bound (headers arrive only when the image is done)", async () => {
    const url = await up((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      setTimeout(() => okImage(res), 600); // longer than the 200ms answer bound below
    });
    const img = await generateCastImageLocal(url, "a portrait", [], { answerTimeoutMs: 200 });
    expect(img.bytes.length).toBeGreaterThan(0);
  });
});

describe("local#490 -- the poll error names the phase first", () => {
  let dir: string;
  let store: FilesystemObjectStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vj-490-"));
    store = new FilesystemObjectStore(dir);
    resetDoorCursorsForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  async function pollOnce(doorUrl: string): Promise<{ ok: boolean; error?: string }> {
    // No OLLAMA_BASE_URL: the GPU handoff is skipped, so the only network in play is the door.
    const env = { CAST_IMAGE_BACKEND_URL: doorUrl } as ChainModuleEnv;
    const invoke = await invokeCastImage(env, store, {
      hook: "cast.image",
      input: { cast_id: 4, portrait_url: `${doorUrl}/portrait.png` },
      config: { num_images: 1 },
      context: { project: "p", job_id: "j" },
    } as never);
    if (!invoke.ok || !("poll" in invoke)) throw new Error("expected a poll token");
    return (await pollCastImage(env, store, { poll: invoke.poll })) as { ok: boolean; error?: string };
  }

  it("a refused door reads 'local door unreachable'", async () => {
    const url = await up(silent);
    await closers.pop()!();
    const r = await pollOnce(url);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^cast\.image: local door unreachable: cast\.image door http:\/\/127\.0\.0\.1:\d+ unreachable/);
  });

  it("a door that answers but fails /generate reads 'local door generation failed'", async () => {
    const url = await up((req, res) => {
      if (req.url === "/generate") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      res.writeHead(200);
      res.end("{}");
    });
    const r = await pollOnce(url);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^cast\.image: local door generation failed: .*\/generate -> 500/);
  });
});
