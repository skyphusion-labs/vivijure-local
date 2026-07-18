// A fake image.generate module worker for tests.
//
// Deliberately NOT named "image-generate": nothing in the projection or dispatch may special-case a
// module NAME, and a fixture that borrowed the first-party name would hide it if something did.

import type { FetcherLike } from "../src/platform/types.js";

// 1x1 PNG, so a test asserts on real image bytes rather than a placeholder string.
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const FAKE_IMAGE_MODELS = ["acme/img-xl", "acme/img-mini"];

export const fakeImageManifest = {
  name: "acme-imagegen",
  version: "1.0.0",
  api: "vivijure-module/2",
  hooks: ["image.generate"],
  provides: [{ id: "acme-img", label: "ACME Image" }],
  binding: "MODULE_ACMEIMAGEGEN",
  config_schema: {
    model: { type: "enum", values: FAKE_IMAGE_MODELS, default: FAKE_IMAGE_MODELS[0], label: "image model" },
  },
};

/** opts.fail -> the module reports an honest failure; opts.pending -> it answers async. */
export function createFakeImageModule(opts: { fail?: string; pending?: boolean; empty?: boolean } = {}): FetcherLike {
  return {
    fetch: async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/module.json") {
        return new Response(JSON.stringify(fakeImageManifest), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (path === "/invoke") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { config?: Record<string, unknown> };
        if (opts.fail) return json({ ok: false, error: opts.fail });
        if (opts.pending) return json({ ok: true, pending: true, poll: "tok" });
        if (opts.empty) return json({ ok: true, output: {} });
        return json({
          ok: true,
          output: { image: { bytes_b64: PNG_B64, mime: "image/png" } },
          // echoed so a test can assert WHICH model the module was asked for
          _model: body.config?.model,
        });
      }
      return json({ ok: false, error: "not found" }, 404);
    },
  } as FetcherLike;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
