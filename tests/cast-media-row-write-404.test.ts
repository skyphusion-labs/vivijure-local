/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";

// local#328 follow-up. A FAILED cast-row write must be a 404 with a diagnostic, never
// HTTP 200 { cast: null }.
//
// WHY THIS FILE EXISTS SEPARATELY FROM cast-upload-register-328.test.ts: that file's
// cast-db mock returns a truthy row UNCONDITIONALLY, so no test in it can reach the
// row-is-null branch at all. The branch was not weakly tested; it was unreachable.
//
// WHAT THE PANEL DOES WITH A 200 { cast: null } (traced in public/cast.js at the three
// file-upload call sites): `state.cast[idx] = data.cast` lands FIRST, so state holds null;
// then `populateEditor(null)` throws on `c.name`; the catch reports a JavaScript
// null-property error instead of "the cast row was not written"; `renderCastList()` never
// runs, so the list keeps rendering stale data while state holds null, and the next
// unrelated re-render hits it. With a 404 the panel's existing `api()` helper throws
// Error(body.error) and every existing catch produces the right message with NO panel change.

const setPortrait = vi.fn();
const addRef = vi.fn();
const addSource = vi.fn();

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
  addRef,
  removeRef: async () => ({ row: { id: 7 }, removedKey: "k" }),
  addSource,
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
      return hit.bytes.buffer.slice(
        hit.bytes.byteOffset,
        hit.bytes.byteOffset + hit.bytes.byteLength,
      );
    },
    head: async (key: string) => (store.has(key) ? { size: store.get(key)!.bytes.length } : null),
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return { store, binding };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ROW = { id: 7, name: "Ada" };

type Handler = (request: Request, env: unknown, id: number) => Promise<Response>;

let store: ReturnType<typeof makeStore>;
let env: {
  R2_RENDERS: ReturnType<typeof makeStore>["binding"];
  R2: ReturnType<typeof makeStore>["binding"];
  DB: object;
};

async function handlers(): Promise<Record<string, Handler>> {
  const m = await import("../src/cast-media.js");
  return {
    portrait: m.handleCastPortraitUpload as Handler,
    ref: m.handleCastRefAdd as Handler,
    source: m.handleCastSourceAdd as Handler,
  };
}

/** JSON copy-register form: the form the panel actually sends for a file upload. */
function copyReq(path: string, srcKey: string): Request {
  return new Request("http://local" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from_chat_artifact: srcKey }),
  });
}

/** Raw-bytes form: the direct image POST the same handlers still accept. */
function bytesReq(path: string): Request {
  return new Request("http://local" + path, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: PNG,
  });
}

// The six sites. Each is one `return json({ cast: row ? toPublicCast(row) : null })` in
// src/cast-media.ts -- three handlers times {copy-register, raw-bytes}. Their three
// `{ key, mime }` siblings already throw 404 and are covered by the control below.
const SITES: Array<{ name: string; which: string; req: () => Request; spy: () => typeof setPortrait }> = [
  { name: "portrait / copy-register", which: "portrait", req: () => copyReq("/api/cast/7/portrait", "uploads/u1.png"), spy: () => setPortrait },
  { name: "portrait / raw-bytes", which: "portrait", req: () => bytesReq("/api/cast/7/portrait"), spy: () => setPortrait },
  { name: "ref / copy-register", which: "ref", req: () => copyReq("/api/cast/7/refs", "uploads/u1.png"), spy: () => addRef },
  { name: "ref / raw-bytes", which: "ref", req: () => bytesReq("/api/cast/7/refs"), spy: () => addRef },
  { name: "source / copy-register", which: "source", req: () => copyReq("/api/cast/7/sources", "uploads/u1.png"), spy: () => addSource },
  { name: "source / raw-bytes", which: "source", req: () => bytesReq("/api/cast/7/sources"), spy: () => addSource },
];

describe("cast media: a failed row write is a 404, never 200 { cast: null }", () => {
  beforeEach(async () => {
    store = makeStore();
    env = { R2_RENDERS: store.binding, R2: store.binding, DB: {} };
    await store.binding.put("uploads/u1.png", PNG, {
      httpMetadata: { contentType: "image/png" },
    });
    // The condition under test: the DB write did not produce a row.
    setPortrait.mockReset().mockResolvedValue(null);
    addRef.mockReset().mockResolvedValue(null);
    addSource.mockReset().mockResolvedValue(null);
  });

  // POSITIVE CONTROL, RUN FIRST AND IN THE SAME FILE AS THE CLAIM.
  // Proves the harness reaches handler code and CAN produce the other answer at all six
  // sites. Without it, six 404s are equally consistent with six handlers that never ran.
  it("CONTROL: with the row written, every one of the six sites returns 200", async () => {
    const h = await handlers();
    setPortrait.mockResolvedValue(ROW);
    addRef.mockResolvedValue(ROW);
    addSource.mockResolvedValue(ROW);
    const seen: string[] = [];
    for (const site of SITES) {
      const res = await h[site.which](site.req(), env, 7);
      seen.push(`${site.name}=${res.status}`);
    }
    expect(seen.join(" "), "control: a site did not reach handler code").toBe(
      SITES.map((s) => `${s.name}=200`).join(" "),
    );
    expect(
      setPortrait.mock.calls.length + addRef.mock.calls.length + addSource.mock.calls.length,
      "control denominator: writes attempted",
    ).toBe(6);
  });

  for (const site of SITES) {
    it(`404 with a diagnostic when the write returns no row: ${site.name}`, async () => {
      const h = await handlers();
      const res = await h[site.which](site.req(), env, 7);
      const body = (await res.clone().json()) as { error?: string; cast?: unknown };

      // Print the evidence beside the verdict: which site, what came back.
      const evidence = `${site.name} -> ${res.status} ${JSON.stringify(body)}`;

      expect(site.spy(), `${site.name}: the write was never attempted`).toHaveBeenCalledTimes(1);
      expect(res.status, evidence).toBe(404);
      expect(String(body.error), evidence).toMatch(/cast not found/);
      expect(
        Object.prototype.hasOwnProperty.call(body, "cast"),
        `${site.name}: a failure must not carry a cast field at all -- ` +
          `200 { cast: null } is what puts null into panel state. ${evidence}`,
      ).toBe(false);
    });
  }
});
