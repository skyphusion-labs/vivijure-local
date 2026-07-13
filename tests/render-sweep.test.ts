import { describe, expect, it } from "vitest";
import { sweepUnresolvedJobs } from "@skyphusion-labs/vivijure-core/render-sweep";
import type { Env } from "@skyphusion-labs/vivijure-core/platform/orchestrator-context";

type Rows = Array<{ job_id: string }>;

function filmIdFromDocKey(key: string): string {
  return key.replace(/^renders\//, "").replace(/\/film-job\.json$/, "");
}

function makeEnv(opts: {
  inWindow?: Rows;
  stranded?: Rows;
  docsInR2?: string[];
}) {
  const inWindow = opts.inWindow ?? [];
  const stranded = opts.stranded ?? [];
  const docs = new Set(opts.docsInR2 ?? []);
  const advanced: string[] = [];

  const prepare = (sql: string) => {
    const isStrandedQuery = sql.includes('"phase":"assemble"');
    const isInWindowQuery = sql.includes("submitted_at >= ?") && !isStrandedQuery;
    return {
      bind: () => prepare(sql),
      all: async () => ({ results: isStrandedQuery ? stranded : isInWindowQuery ? inWindow : [] }),
      first: async () => null,
      run: async () => ({ success: true }),
    };
  };

  const env = {
    DB: { prepare: (sql: string) => prepare(sql) },
    R2_RENDERS: {
      head: async (key: string) => (docs.has(filmIdFromDocKey(key)) ? {} : null),
      get: async (key: string) => {
        const id = filmIdFromDocKey(key);
        if (!docs.has(id)) return null;
        advanced.push(id);
        return {
          text: async () =>
            JSON.stringify({ film_id: id, project: "p", scenes: [], phase: "done" }),
        };
      },
      put: async () => {},
    },
  } as unknown as Env;
  return { env, advanced };
}

describe("render-sweep (homelab host)", () => {
  it("re-drives a stranded post-clips film job whose doc still exists", async () => {
    const id = "film-stranded-1";
    const { env, advanced } = makeEnv({ stranded: [{ job_id: id }], docsInR2: [id] });
    const n = await sweepUnresolvedJobs(env);
    expect(advanced).toContain(id);
    expect(n).toBe(1);
  });

  it("skips stranded jobs whose doc was swept", async () => {
    const id = "film-stranded-2";
    const { env, advanced } = makeEnv({ stranded: [{ job_id: id }], docsInR2: [] });
    const n = await sweepUnresolvedJobs(env);
    expect(advanced).not.toContain(id);
    expect(n).toBe(0);
  });
});

describe("cloud-keyframe keyframe-core", () => {
  it("clamps model and dimensions", async () => {
    const { clampModel, clampDim, composePrompt } = await import("../src/modules/cloud-keyframe/keyframe-core.js");
    expect(clampModel("google/nano-banana-pro")).toBe("google/nano-banana-pro");
    expect(clampModel("bogus")).toMatch(/^@cf\//);
    expect(clampDim(9999, 768)).toBe(1536);
    expect(
      composePrompt("noir", "a rainy alley", ["A"], { A: { name: "Wren", prompt: "detective", image: "x.png" } }),
    ).toContain("Wren");
  });
});
