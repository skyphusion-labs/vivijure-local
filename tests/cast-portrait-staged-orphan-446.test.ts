/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";

// local#446. The JSON { key, mime } staged-key branch of handleCastPortraitUpload wrote
// the new portrait_key and never collected the previous object. The chat-artifact and
// raw-bytes branches already call deleteSupersededPortrait after the row write succeeds.
// This file is the collection claim for the staged-key branch, and it goes red if that
// call is removed.
//
// The same-key case is the guard on the helper's oldKey === newKey skip: a re-register
// of the key the row already holds must not delete the live object. The null-row case
// is the guard on ordering: a failed row write must not delete anything, because
// portrait_key was never updated.

const setPortrait = vi.fn();

vi.mock("@skyphusion-labs/vivijure-core/cast-db", () => ({
  getCastById: async () => ({
    id: 7,
    public_id: "x",
    name: "Ada",
    portrait_key: OLD_KEY,
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

const OLD_KEY = "cast/7/portrait.jpg";
const NEW_KEY = "cast/7/portrait.png";
const ROW = { id: 7, name: "Ada", portrait_key: NEW_KEY };

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

function makeStore() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const ops: string[] = [];
  const binding = {
    put: async (
      key: string,
      bytes: ArrayBuffer | Uint8Array | string,
      opts?: { httpMetadata?: { contentType?: string } },
    ) => {
      ops.push(`put:${key}`);
      const b =
        typeof bytes === "string"
          ? new TextEncoder().encode(bytes)
          : bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes);
      store.set(key, {
        bytes: b,
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
      return hit.bytes.buffer.slice(
        hit.bytes.byteOffset,
        hit.bytes.byteOffset + hit.bytes.byteLength,
      );
    },
    getRange: async () => null,
    head: async (key: string) => (store.has(key) ? { size: store.get(key)!.bytes.length } : null),
    delete: async (key: string) => {
      ops.push(`delete:${key}`);
      store.delete(key);
    },
  };
  return { store, ops, binding };
}

type Handler = (request: Request, env: unknown, id: number) => Promise<Response>;

let s: ReturnType<typeof makeStore>;
let env: {
  R2_RENDERS: ReturnType<typeof makeStore>["binding"];
  R2: ReturnType<typeof makeStore>["binding"];
  DB: object;
};

async function portraitHandler(): Promise<Handler> {
  const m = await import("../src/cast-media.js");
  return m.handleCastPortraitUpload as Handler;
}

function stagedReq(key: string, mime: string): Request {
  return new Request("http://local/api/cast/7/portrait", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, mime }),
  });
}

beforeEach(async () => {
  s = makeStore();
  env = { R2_RENDERS: s.binding, R2: s.binding, DB: {} };
  await s.binding.put(OLD_KEY, JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  s.ops.length = 0;
  setPortrait.mockReset().mockImplementation(async () => {
    s.ops.push("setPortrait");
    return ROW;
  });
});

describe("local#446: staged-key portrait replacement collects the superseded object", () => {
  it("a staged-key replacement deletes the previous portrait key after the row write", async () => {
    const h = await portraitHandler();
    const res = await h(stagedReq(NEW_KEY, "image/png"), env, 7);
    expect(res.status, `ops=${s.ops.join(" ")}`).toBe(200);
    expect(setPortrait).toHaveBeenCalledTimes(1);
    expect(setPortrait.mock.calls[0][2]).toBe(NEW_KEY);
    expect(await s.binding.head(OLD_KEY), "superseded portrait was not collected").toBeNull();
    // Removing the deleteSupersededPortrait call on the staged-key branch leaves
    // ops at ["setPortrait"] and this assertion fails.
    expect(s.ops, "the previous key is deleted only after setPortrait returns a row").toEqual([
      "setPortrait",
      `delete:${OLD_KEY}`,
    ]);
  });

  it("a re-register of the same staged key does not delete it", async () => {
    const h = await portraitHandler();
    const res = await h(stagedReq(OLD_KEY, "image/jpeg"), env, 7);
    expect(res.status, `ops=${s.ops.join(" ")}`).toBe(200);
    expect(setPortrait.mock.calls[0][2]).toBe(OLD_KEY);
    expect(await s.binding.head(OLD_KEY), "the live portrait was deleted").not.toBeNull();
    expect(s.ops, "oldKey === newKey must not delete the object the row still names").toEqual([
      "setPortrait",
    ]);
  });

  it("a failed staged-key row write does not delete the previous portrait", async () => {
    setPortrait.mockImplementation(async () => {
      s.ops.push("setPortrait");
      return null;
    });
    const h = await portraitHandler();
    const res = await h(stagedReq(NEW_KEY, "image/png"), env, 7);
    expect(res.status, `ops=${s.ops.join(" ")}`).toBe(404);
    expect(await s.binding.head(OLD_KEY), "portrait_key still names the old object").not.toBeNull();
    expect(s.ops.filter((o) => o.startsWith("delete:")), "a null row must not collect").toEqual([]);
  });
});
