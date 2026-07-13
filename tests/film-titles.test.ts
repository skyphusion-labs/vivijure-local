import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coerceConfig,
  hasCards,
  hasTitleCard,
  buildContainerSpec,
  passthroughOutput,
  completedOutput,
  encodePoll,
  decodePoll,
  type FinishPoll,
} from "../src/modules/cpu/film-titles-core.js";
import { createCpuModuleApp } from "../src/modules/cpu/app.js";
import type { FilmFinishInput } from "@skyphusion-labs/vivijure-core";
import { checkHookOutput } from "@skyphusion-labs/vivijure-core";

type FilmFinishTestInput = FilmFinishInput & { width?: number; height?: number; fps?: number };

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "../dev/manifests/film-titles.json"), "utf8"),
) as Record<string, unknown>;

const baseInput = (over: Partial<FilmFinishTestInput> = {}): FilmFinishTestInput => ({
  film_key: "renders/film-x/film.mp4",
  video_url: "https://r2/get",
  output_url: "https://r2/put",
  output_key: "renders/film-x/film_titled.mp4",
  captions: [],
  sidecar_url: "https://r2/sidecar-put",
  sidecar_key: "renders/film-x/film_titled.srt",
  width: 1920,
  height: 1080,
  fps: 24,
  ...over,
});

describe("film-titles pure logic", () => {
  it("hasCards is true only with a non-empty title or credits", () => {
    expect(hasCards(baseInput())).toBe(false);
    expect(hasCards(baseInput({ title: { text: "NEON HALFLIFE" } }))).toBe(true);
    expect(hasCards(baseInput({ credits: { lines: ["directed by you"] } }))).toBe(true);
  });

  it("buildContainerSpec forwards presigned urls + only includes present cards", () => {
    const cfg = coerceConfig({});
    const noCards = buildContainerSpec(baseInput(), cfg);
    expect(noCards.title).toBeUndefined();
    const full = buildContainerSpec(
      baseInput({ title: { text: "NEON HALFLIFE" }, credits: { lines: ["directed by you"] } }),
      cfg,
    );
    expect(full.title).toMatchObject({ text: "NEON HALFLIFE", seconds: 3 });
    expect(full.credits).toEqual({ lines: ["directed by you"], seconds: 5 });
  });

  it("passthroughOutput keeps the original film_key", () => {
    const out = passthroughOutput(baseInput(), "noop:no-cards");
    expect(out.film_key).toBe("renders/film-x/film.mp4");
    expect(out.applied).toEqual(["noop:no-cards"]);
  });
});

describe("film-titles module invoke", () => {
  function vpcEnv(over: {
    asyncSupported?: boolean;
    statusResult?: { status: string; result?: unknown; error?: string };
    syncStatus?: number;
    syncBody?: unknown;
    throws?: boolean;
  } = {}) {
    const calls: string[] = [];
    const asyncSupported = over.asyncSupported ?? true;
    const j = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const env = {
      VIDEO_FINISH_VPC: {
        async fetch(input: Request | string) {
          const url = typeof input === "string" ? input : input.url;
          calls.push(url);
          if (over.throws) throw new TypeError("Invalid URL");
          const path = new URL(url).pathname;
          if (path.startsWith("/async/status/")) {
            const st = over.statusResult ?? { status: "completed", result: { ok: true, key: "renders/film-x/film_titled.mp4" } };
            return j(st, st.status === "not_found" ? 404 : 200);
          }
          if (path.startsWith("/async/")) {
            return asyncSupported ? j({ ok: true, jobId: "job-abc", status: "pending" }, 202) : j({ ok: false }, 404);
          }
          return j(over.syncBody ?? { ok: true, key: "renders/film-x/film_titled.mp4" }, over.syncStatus ?? 200);
        },
      },
    };
    const app = createCpuModuleApp(manifest, "film-titles", () => Promise.resolve(env));
    return { app, calls };
  }

  const invoke = (input: FilmFinishInput) =>
    new Request("http://module/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook: "film.finish", input, config: {}, context: {} }),
    });
  const pollReq = (token: string) =>
    new Request("http://module/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poll: token }),
    });

  it("submits async and returns a poll token", async () => {
    const { app, calls } = vpcEnv();
    const res = await app.fetch(invoke(baseInput({ title: { text: "NEON HALFLIFE" } })));
    const json = (await res.json()) as { ok: boolean; pending?: boolean; poll?: string };
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).pathname).toBe("/async/film-titles");
    expect(json.ok).toBe(true);
    expect(json.pending).toBe(true);
    expect(typeof json.poll).toBe("string");
  });

  it("polls to the carded film on completion", async () => {
    const { app } = vpcEnv();
    const sub = (await (await app.fetch(invoke(baseInput({ title: { text: "NEON HALFLIFE" } })))).json()) as { poll: string };
    const res = await app.fetch(pollReq(sub.poll));
    const json = (await res.json()) as { ok: boolean; output: { film_key: string; applied: string[] } };
    expect(json.ok).toBe(true);
    expect(json.output.film_key).toBe("renders/film-x/film_titled.mp4");
    expect(json.output.applied).toEqual(["film-titles"]);
  });

  it("falls back to sync route when async is unsupported", async () => {
    const { app, calls } = vpcEnv({ asyncSupported: false });
    const res = await app.fetch(invoke(baseInput({ title: { text: "NEON HALFLIFE" } })));
    const json = (await res.json()) as { ok: boolean; output: { film_key: string } };
    expect(calls.map((c) => new URL(c).pathname)).toEqual(["/async/film-titles", "/film-titles"]);
    expect(json.output.film_key).toBe("renders/film-x/film_titled.mp4");
  });

  it("no-ops without container when there are no cards", async () => {
    const { app, calls } = vpcEnv();
    const res = await app.fetch(invoke(baseInput()));
    const json = (await res.json()) as { ok: boolean; output: { degraded?: string } };
    expect(calls).toHaveLength(0);
    expect(json.ok).toBe(true);
    expect(json.output.degraded).toBeUndefined();
  });
});

describe("film-titles prepend_seconds", () => {
  it("hasTitleCard is true only for a non-empty opening title", () => {
    expect(hasTitleCard(baseInput({ title: { text: "NEON HALFLIFE" } }))).toBe(true);
    expect(hasTitleCard(baseInput({ credits: { lines: ["directed by you"] } }))).toBe(false);
  });

  it("completedOutput reports prepend_seconds from title card duration", () => {
    const st: FinishPoll = {
      jobId: "j",
      filmKey: "renders/film-x/film.mp4",
      outputKey: "renders/film-x/film-ff1.mp4",
      submittedAt: 0,
      titleSeconds: 3,
    };
    expect(completedOutput({ key: "renders/film-x/film-ff1.mp4" }, st).prepend_seconds).toBe(3);
  });

  it("encode/decode poll preserves titleSeconds", () => {
    const token = encodePoll({ jobId: "j", filmKey: "f", outputKey: "o", submittedAt: 10, titleSeconds: 8 });
    expect(decodePoll(token)?.titleSeconds).toBe(8);
  });

  it("prepend_seconds passes film.finish conformance", () => {
    expect(checkHookOutput("film.finish", { film_key: "k", applied: ["film-titles"], prepend_seconds: 3 }).pass).toBe(true);
  });
});
