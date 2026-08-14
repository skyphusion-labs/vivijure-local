/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// local#328 / cf#336 -- upload-then-register as one flow.
// Panel stages via POST /api/upload (uploads/), then must register by copy (from_chat_artifact).
// { key, mime } is bound to cast/<id>/ only; an uploads/ key must be refused.

const setPortrait = vi.fn(async (_e: unknown, _id: number, key: string, mime: string) => ({
  id: 7,
  name: "Ada",
  portrait_key: key,
  portrait_mime: mime,
}));

vi.mock("@skyphusion-labs/vivijure-core/cast-db", () => ({
  getCastById: async () => ({
    id: 7,
    public_id: "x",
    name: "Ada",
    portrait_key: null,
    ref_keys: [],
    source_keys: [],
  }),
  clearPortrait: async () => ({ id: 7 }),
  setPortrait,
  addRef: async () => ({ id: 7 }),
  removeRef: async () => ({ row: { id: 7 }, removedKey: "k" }),
  addSource: async () => ({ id: 7 }),
  removeSource: async () => ({ row: { id: 7 }, removedKey: "k" }),
  toPublicCast: (r: unknown) => r,
}));

function makeStore() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const binding = {
    put: async (
      key: string,
      bytes: ArrayBuffer | Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) => {
      store.set(key, {
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    getBytes: async (key: string) => {
      const hit = store.get(key);
      if (!hit) return null;
      return { bytes: hit.bytes, contentType: hit.contentType, size: hit.bytes.length };
    },
    get: async (key: string) => {
      const hit = store.get(key);
      if (!hit) return null;
      return hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength);
    },
    head: async (key: string) => (store.has(key) ? { size: store.get(key)!.bytes.length } : null),
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return { store, binding };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML = new TextEncoder().encode("<script>alert(1)</script>");

describe("local#328 upload-then-register handlers", () => {
  let store: ReturnType<typeof makeStore>;
  let env: { R2_RENDERS: ReturnType<typeof makeStore>["binding"]; R2: ReturnType<typeof makeStore>["binding"]; DB: object };

  beforeEach(() => {
    setPortrait.mockClear();
    store = makeStore();
    env = { R2_RENDERS: store.binding, R2: store.binding, DB: {} };
  });

  it("the flow the panel now performs: register by COPY", async () => {
    await store.binding.put("uploads/u1.png", PNG, { httpMetadata: { contentType: "image/png" } });
    const { handleCastPortraitUpload } = await import("../src/cast-media.js");
    const res = await handleCastPortraitUpload(
      new Request("http://local/api/cast/7/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_chat_artifact: "uploads/u1.png" }),
      }),
      env as never,
      7,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(setPortrait.mock.calls[0][2]).toMatch(/^cast\/7\/portrait\./);
  });

  it("REGRESSION: { key, mime } with an uploads/ key is refused", async () => {
    const { handleCastPortraitUpload } = await import("../src/cast-media.js");
    const res = await handleCastPortraitUpload(
      new Request("http://local/api/cast/7/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "uploads/u1.png", mime: "image/png" }),
      }),
      env as never,
      7,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(String(body.error)).toMatch(/safe staged path/);
    expect(setPortrait).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: staged-key form still works under cast/<id>/", async () => {
    const { handleCastPortraitUpload } = await import("../src/cast-media.js");
    const res = await handleCastPortraitUpload(
      new Request("http://local/api/cast/7/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "cast/7/portrait.png", mime: "image/png" }),
      }),
      env as never,
      7,
    );
    expect(res.status).toBe(200);
    expect(setPortrait).toHaveBeenCalledTimes(1);
  });

  it("COPY path validates BYTES (HTML claiming image/png is refused)", async () => {
    await store.binding.put("uploads/liar.png", HTML, { httpMetadata: { contentType: "image/png" } });
    const { handleCastPortraitUpload } = await import("../src/cast-media.js");
    const res = await handleCastPortraitUpload(
      new Request("http://local/api/cast/7/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_chat_artifact: "uploads/liar.png" }),
      }),
      env as never,
      7,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(String(body.error)).toMatch(/recognizable|does not match/);
    expect(setPortrait).not.toHaveBeenCalled();
  });
});

describe("local#328 the panel sends the copy form", () => {
  const CAST_JS = readFileSync(`${process.cwd()}/public/cast.js`, "utf8");

  it("all three file-upload call sites register by copy", () => {
    const copies = CAST_JS.match(/body: JSON\.stringify\(\{ from_chat_artifact: key \}\)/g) ?? [];
    expect(copies.length, "a cast register call site stopped using the copy form").toBeGreaterThanOrEqual(3);
  });

  it("REGRESSION: no cast register call site sends the { key, mime } body again", () => {
    expect(CAST_JS).not.toContain("JSON.stringify({ key, mime })");
  });

  it("uploadBytes returns the key ALONE", () => {
    expect(CAST_JS).toContain("return up.key;");
    expect(CAST_JS).not.toContain("return { key: up.key, mime: up.mime || file.type };");
  });

  it("POSITIVE CONTROL: the matcher can see the file it is reading", () => {
    expect(CAST_JS.length).toBeGreaterThan(1000);
    expect(CAST_JS).toContain("async function uploadBytes(file)");
  });
});
