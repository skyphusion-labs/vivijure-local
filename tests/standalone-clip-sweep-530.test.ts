import { describe, expect, it, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startClipJob, CLIP_SUBMIT_BATCH, type ClipJob } from "@skyphusion-labs/vivijure-core/render-orchestrator";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { recordStandaloneClipJob, pollStandaloneClipJob } from "../src/routes/m9-render-api.js";
import { sweepStandaloneClipJobs } from "../src/clip-job-sweep.js";
import { withClipJobLease } from "../src/clip-job-lease.js";
import { clipJobOwnerKey } from "../src/clip-job-row.js";
import { craftFilmBytes } from "./helpers/mp4.js";

// local#530: a standalone clip job of more than CLIP_SUBMIT_BATCH (20) shots buys its later batches from
// advanceClipJob, and before this only its own GET advanced it, so an unpolled job stopped after 20.
// Real vivijure-core startClipJob / advanceClipJob, real SQLite with this repo's migrations, and a fake
// motion door that answers /module.json, /invoke and /poll and counts every paid invoke.

function realDb() {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db, d1: { prepare: (sql: string) => stmt(sql), batch: async (ss: Array<{ run(): Promise<unknown> }>) => { const out = []; for (const s of ss) out.push(await s.run()); return out; } } };
}

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });

function harness() {
  const { db, d1 } = realDb();
  const store = new Map<string, Uint8Array>();
  const enc = (v: unknown) => (typeof v === "string" ? new TextEncoder().encode(v) : (v as Uint8Array));
  const r2 = {
    put: async (k: string, v: unknown) => { store.set(k, enc(v)); },
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const whole = store.get(k);
      if (!whole) return null;
      const off = o?.range?.offset ?? 0;
      const v = whole.slice(off, off + (o?.range?.length ?? whole.length - off));
      return { text: async () => new TextDecoder().decode(v), arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength), body: v };
    },
    head: async (k: string) => { const v = store.get(k); return v ? { size: v.length, etag: String(v.length) } : null; },
    list: async ({ prefix }: { prefix: string }) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date() })), truncated: false }),
    delete: async (k: string) => { store.delete(k); },
  };
  const invokes: string[] = [];
  const polls = new Map<string, number>();
  const env = {
    DB: d1,
    R2_RENDERS: r2,
    PRESIGNER: { presignGet: async (k: string) => `https://g/${k}`, presignPut: async (k: string) => `https://p/${k}` },
    MODULE_DOOR530: {
      fetch: async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/module.json")) {
          return json({ name: "door530", version: "1", api: "vivijure-module/2", hooks: ["motion.backend"], participation: "default",
            max_invocation_seconds: 600, config_schema: {}, ui: { order: 1, section: "motion", locality: "cloud" } });
        }
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (String(url).endsWith("/invoke")) {
          invokes.push(body.input.shot_id as string);
          return json({ ok: true, pending: true, poll: `tok-${body.input.shot_id}` });
        }
        if (String(url).endsWith("/poll")) {
          const shot = String(body.poll).slice(4);
          const n = (polls.get(shot) ?? 0) + 1;
          polls.set(shot, n);
          if (n < 2) return json({ ok: true, pending: true });
          const clip_key = `renders/p/clips/${shot}_door.mp4`;
          store.set(clip_key, craftFilmBytes({ durationS: 5, frames: 120 }));
          return json({ ok: true, output: { shot_id: shot, clip_key, fps: 24, frames: 120 } });
        }
        return json({ ok: false, error: "unexpected route" });
      },
    },
  } as unknown as OrchestratorEnv;
  const rowStatus = (id: string) => (db.prepare("SELECT status FROM renders WHERE job_id = ?").get(id) as { status: string } | undefined)?.status;
  const doc = (id: string) => JSON.parse(new TextDecoder().decode(store.get(`renders/${id}/clips-job.json`)!)) as ClipJob;
  return { env, db, store, invokes, rowStatus, doc };
}

const shots = (n: number) => Array.from({ length: n }, (_u, i) => {
  const id = `shot_${String(i + 1).padStart(3, "0")}`;
  return { shot_id: id, keyframe_url: "https://g/k", keyframe_key: `renders/p/keyframes/${id}.png`, prompt: id, seconds: 5 };
});

async function startStandalone(h: ReturnType<typeof harness>, n: number): Promise<string> {
  const job = await startClipJob(h.env, { project: "p", shots: shots(n) });
  await recordStandaloneClipJob(h.env, job);
  return job.job_id;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("local#530 the sweep drives a standalone clip job nobody polls", () => {
  it("records the job: owner marker and a renders row in mode clips", async () => {
    const h = harness();
    const id = await startStandalone(h, 3);
    expect(h.store.has(clipJobOwnerKey(id))).toBe(true);
    expect(h.db.prepare("SELECT mode, status FROM renders WHERE job_id = ?").get(id)).toEqual({ mode: "clips", status: "IN_PROGRESS" });
  });

  it("THE 21st SHOT: the sweep alone buys the second batch and finishes the job", async () => {
    const h = harness();
    const id = await startStandalone(h, CLIP_SUBMIT_BATCH + 1);
    expect(new Set(h.invokes).size, "startClipJob buys the first batch only").toBe(CLIP_SUBMIT_BATCH);
    for (let i = 0; i < 20 && h.doc(id).shots.some((s) => s.status === "pending"); i++) await sweepStandaloneClipJobs(h.env, i * 60_000);
    expect(h.invokes).toContain(`shot_${String(CLIP_SUBMIT_BATCH + 1).padStart(3, "0")}`);
    expect(h.doc(id).shots.every((s) => s.status === "done")).toBe(true);
    expect(h.rowStatus(id)).toBe("COMPLETED");
    // Each shot was bought once: two drivers never bought one batch twice.
    expect(h.invokes.length).toBe(CLIP_SUBMIT_BATCH + 1);
  });

  it("CONTROL: with no sweep and no GET, the 21st shot is never bought", async () => {
    const h = harness();
    const id = await startStandalone(h, CLIP_SUBMIT_BATCH + 1);
    expect(h.invokes).not.toContain(`shot_${String(CLIP_SUBMIT_BATCH + 1).padStart(3, "0")}`);
    expect(h.rowStatus(id)).toBe("IN_PROGRESS");
  });

  it("the sweep and the GET share one lease: a sweep that meets a held lease advances nothing", async () => {
    const h = harness();
    const id = await startStandalone(h, 2);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const holder = withClipJobLease(h.env, id, () => held);
    await new Promise((r) => setTimeout(r, 0));
    const before = h.invokes.length;
    const pass = await sweepStandaloneClipJobs(h.env);
    expect([pass.busy, pass.advanced]).toEqual([1, 0]);
    expect(h.invokes.length).toBe(before);
    release();
    await holder;
    const after = await sweepStandaloneClipJobs(h.env);
    expect(after.advanced, "CONTROL: once released, the sweep advances it").toBe(1);
  });

  it("a clips-* row without the owner marker (not born standalone) is never driven by the sweep", async () => {
    const h = harness();
    const id = await startStandalone(h, 2);
    h.store.delete(clipJobOwnerKey(id));
    const pass = await sweepStandaloneClipJobs(h.env);
    expect([pass.not_standalone, pass.advanced]).toEqual([1, 0]);
  });

  it("a GET advances under the lease and heals a missing row", async () => {
    const h = harness();
    const id = await startStandalone(h, 2);
    h.db.prepare("DELETE FROM renders WHERE job_id = ?").run(id);
    const r = await pollStandaloneClipJob(h.env, id);
    expect(r.advanced).toBe(true);
    expect(r.job?.job_id).toBe(id);
    expect(h.rowStatus(id)).toBe("IN_PROGRESS");
  });

  it("terminal rows are not listed again", async () => {
    const h = harness();
    const id = await startStandalone(h, 1);
    for (let i = 0; i < 5; i++) await sweepStandaloneClipJobs(h.env, i * 60_000);
    expect(h.rowStatus(id)).toBe("COMPLETED");
    const pass = await sweepStandaloneClipJobs(h.env);
    expect(pass.listed).toBe(0);
  });
});
