/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";

// local#407. The old portrait object was deleted BEFORE the replacement copy was awaited, so a
// throwing copy left `portrait_key` naming an object that no longer existed.
//
// WHY THIS IS WORTH A TEST RATHER THAN JUST A REORDER: the failure's visible half is honest and
// its durable half is silent. The request throws, returns 5xx, and counts correctly as an error
// in any load-test tally. What it leaves behind -- a row pointing at a deleted key -- is not
// counted anywhere, so a run that hit this window reports a clean error rate while having
// corrupted data. A pass/fail harness cannot see it by construction.
//
// THE ASSERTION IS ABOUT THE SURVIVING OBJECT, NOT ABOUT THE ERROR. Asserting "the request
// throws" would pass against BOTH orderings, which is exactly the shape that lets a revert
// through green.

const setPortrait = vi.fn(async (_env: unknown, _id: number, key: string, mime: string) => ({
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
    portrait_key: OLD_KEY,
    ref_keys: [],
    source_keys: [],
  }),
  clearPortrait: async () => ({ id: 7 }),
  setPortrait,
  addRef: vi.fn(),
  removeRef: async () => ({ row: { id: 7 }, removedKey: "k" }),
  addSource: vi.fn(),
  removeSource: async () => ({ row: { id: 7 }, removedKey: "k" }),
  toPublicCast: (r: unknown) => r,
}));

const OLD_KEY = "cast/7/portrait-old.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function makeStore() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const binding = {
    put: async (key: string, bytes: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, {
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    getBytes: async (key: string) => {
      const hit = store.get(key);
      return hit ? { bytes: hit.bytes, contentType: hit.contentType, size: hit.bytes.length } : null;
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

let store: ReturnType<typeof makeStore>;
let env: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore();
  store.store.set(OLD_KEY, { bytes: PNG, contentType: "image/png" });
  env = { R2_RENDERS: store.binding, R2: store.binding, DB: {} };
});

function copyReq(src: string): Request {
  return new Request("http://local/api/cast/7/portrait", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_chat_artifact: src }),
  });
}

async function portraitHandler() {
  const m = await import("../src/cast-media.js");
  return m.handleCastPortraitUpload as (r: Request, e: unknown, id: number) => Promise<Response>;
}

describe("local#407 -- the old portrait survives a failed replacement copy", () => {
  it("CONTROL: the fixture is real -- the old object exists before the request", () => {
    expect(
      store.store.has(OLD_KEY),
      "the whole test is vacuous if the object it watches was never there",
    ).toBe(true);
  });

  it("a THROWING copy must leave the old object intact", async () => {
    // Source key absent from the store, so copyChatArtifactToRenders cannot resolve it and throws.
    const handler = await portraitHandler();
    const res = await handler(copyReq("uploads/does-not-exist.png"), env, 7);

    // Denominator beside the claim: prove the failure actually happened, so a passing assertion
    // below cannot mean "the copy quietly succeeded".
    //
    // ASSERT ON THE RESPONSE, NOT ON A THROW. copyChatArtifactToRenders throws HttpError(404),
    // but handleCastPortraitUpload runs inside wrap(), which converts it to a Response -- so the
    // handler never throws and a try/catch control reports "no failure" on a real failure. That
    // exact mistake is why this comment exists: my first version of this test caught nothing and
    // its control told me so.
    expect(res.status, "control: the copy was supposed to fail and did not").toBe(404);

    // THE CLAIM. Under the old ordering the delete had already run, so this is false.
    expect(
      store.store.has(OLD_KEY),
      `portrait_key still names ${OLD_KEY}; deleting it before the replacement exists is local#407`,
    ).toBe(true);

    // And the row must not have been repointed at a key that was never written.
    expect(setPortrait, "no row write should happen when the copy failed").not.toHaveBeenCalled();
  });

  it("a SUCCEEDING copy still retires the old object", async () => {
    store.store.set("uploads/new.png", { bytes: PNG, contentType: "image/png" });
    const handler = await portraitHandler();
    const res = await handler(copyReq("uploads/new.png"), env, 7);
    expect(res.status, "the success path must still work").toBe(200);

    // Non-default probe: the new key is a DIFFERENT key from the old one, so "retired the old"
    // and "did nothing" are distinguishable. On a same-key fixture they would be identical.
    expect(
      store.store.has(OLD_KEY),
      "the superseded object should not be left orphaned once a replacement exists",
    ).toBe(false);
    expect(setPortrait).toHaveBeenCalledTimes(1);
  });
});
