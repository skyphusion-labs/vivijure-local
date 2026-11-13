// local#580: a BINARY aiRun response (Aura-1 TTS, image models) was read with resp.arrayBuffer() and no
// cap, then stored. It now goes through readCappedBytes with a per-kind cap and is refused above it.
// No spend: fetch is stubbed. The stub proves the decision path; the cap reader itself is the vendored one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIRUN_AUDIO_MAX_BYTES, AIRUN_IMAGE_MAX_BYTES, aiRun, aiRunBinaryCap } from "../src/platform/ai-run.js";
import { CappedReadError } from "../src/modules/gateway-i2v/shared/provider-media.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123", CF_AIG_TOKEN: "tok" };
const MODEL = "@cf/deepgram/aura-1";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(make: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async () => make()));
}

/** A body that yields `total` bytes in 1 MiB chunks and counts how many chunks were pulled. */
function chunked(total: number, pulled: { n: number }): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (sent >= total) return ctl.close();
      const n = Math.min(1024 * 1024, total - sent);
      sent += n;
      pulled.n++;
      ctl.enqueue(new Uint8Array(n).fill(7));
    },
  }, { highWaterMark: 0 }); // no prefetch: a pull happens only when the code under test reads
}

describe("aiRun binary cap (local#580)", () => {
  it("names the caps: audio 32 MB, image 25 MB", () => {
    expect(AIRUN_AUDIO_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(aiRunBinaryCap("audio/mpeg")).toBe(AIRUN_AUDIO_MAX_BYTES);
    expect(aiRunBinaryCap("image/png")).toBe(AIRUN_IMAGE_MAX_BYTES);
    expect(aiRunBinaryCap("application/octet-stream")).toBe(AIRUN_IMAGE_MAX_BYTES);
  });

  it("an under-cap binary response comes back byte-identical", async () => {
    const src = new Uint8Array(4096).map((_, i) => i % 251);
    stubFetch(() => new Response(src, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const out = (await aiRun(ENV, MODEL, { text: "hi" })) as ArrayBuffer;
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(out).equals(Buffer.from(src))).toBe(true);
  });

  it("an over-cap streamed body is refused, naming the cap and the model, and the read stops early", async () => {
    const pulled = { n: 0 };
    stubFetch(() => new Response(chunked(AIRUN_AUDIO_MAX_BYTES + 5 * 1024 * 1024, pulled), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const err = await aiRun(ENV, MODEL, { text: "hi" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CappedReadError);
    expect((err as Error).message).toContain(String(AIRUN_AUDIO_MAX_BYTES));
    expect((err as Error).message).toContain(MODEL);
    expect(pulled.n).toBeLessThan(40);
  });

  it("an over-cap image response is refused at the image cap", async () => {
    const pulled = { n: 0 };
    stubFetch(() => new Response(chunked(AIRUN_IMAGE_MAX_BYTES + 1024 * 1024, pulled), { status: 200, headers: { "content-type": "image/png" } }));
    const err = await aiRun(ENV, "@cf/black-forest-labs/flux-2-dev", { prompt: "p" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CappedReadError);
    expect((err as Error).message).toContain(String(AIRUN_IMAGE_MAX_BYTES));
  });

  it("a Content-Length over the cap is refused before the body is read", async () => {
    const pulled = { n: 0 };
    stubFetch(() => new Response(chunked(1024 * 1024, pulled), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": String(AIRUN_AUDIO_MAX_BYTES + 1) },
    }));
    const err = await aiRun(ENV, MODEL, { text: "hi" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CappedReadError);
    expect((err as Error).message).toContain(MODEL);
    expect(pulled.n).toBe(0);
  });

  it("the JSON path is unchanged, even for a large JSON body", async () => {
    stubFetch(() => new Response(JSON.stringify({ result: { response: "x".repeat(1024) } }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await aiRun(ENV, "@cf/meta/llama", { prompt: "p" })).toEqual({ response: "x".repeat(1024) });
  });
});
