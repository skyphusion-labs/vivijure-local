// local#530: advance the standalone clip jobs nobody polls. Ported from vivijure-cf
// src/clip-job-sweep.ts (cf#1316).
//
// The render sweep loop (src/server.ts) runs core's sweepUnresolvedJobs, which drives film-* and
// scatter-* jobs only. This pass is the second driver for clips-* jobs: it takes the SAME lease as the
// GET route (withClipJobLease), so the two never advance one job at once, and it gives an advanced job
// the same row update a GET does. Bounded: CLIP_SWEEP_PAGE jobs a pass, paged with core's
// rotatingOffset by the minute, so jobs that cannot move do not starve the rest.

import { advanceClipJob } from "@skyphusion-labs/vivijure-core/render-orchestrator";
import { updateRenderFromView } from "@skyphusion-labs/vivijure-core/renders-db";
import { rotatingOffset } from "@skyphusion-labs/vivijure-core/render-sweep";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { clipJobToPollView, isStandaloneClipJob } from "./clip-job-row.js";
import { ensureClipJobRow, withClipJobLease } from "./clip-job-lease.js";

/** The most standalone clip jobs one pass advances. Each advance makes at most 20 polls and 20
 *  submits (core CLIP_MAX_IN_FLIGHT). */
export const CLIP_SWEEP_PAGE = 5;

/** Statuses a clip job row never leaves (core TERMINAL_STATUSES). */
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;

export interface ClipSweepResult {
  total: number;
  listed: number;
  advanced: number;
  busy: number;
  not_standalone: number;
  missing: number;
  failed: number;
}

/** Non-terminal clip job rows, oldest submission first, one page. */
export async function listUnresolvedClipJobs(env: OrchestratorEnv, limit: number, offset: number): Promise<{ ids: string[]; total: number }> {
  const terminal = TERMINAL.map(() => "?").join(", ");
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM renders WHERE job_id LIKE 'clips-%' AND status NOT IN (${terminal})`,
  ).bind(...TERMINAL).first<{ n: number }>();
  const res = await env.DB.prepare(
    `SELECT job_id FROM renders WHERE job_id LIKE 'clips-%' AND status NOT IN (${terminal})
       ORDER BY submitted_at ASC, id ASC LIMIT ? OFFSET ?`,
  ).bind(...TERMINAL, limit, offset).all<{ job_id: string }>();
  return { ids: (res.results ?? []).map((r) => String(r.job_id)).filter(Boolean), total: Number(count?.n ?? 0) };
}

/** One pass over standalone clip jobs. Never throws for one job; counts what happened. */
export async function sweepStandaloneClipJobs(env: OrchestratorEnv, now: number = Date.now()): Promise<ClipSweepResult> {
  const first = await listUnresolvedClipJobs(env, CLIP_SWEEP_PAGE, 0);
  const offset = rotatingOffset(first.total, CLIP_SWEEP_PAGE, Math.floor(now / 60_000));
  const page = offset === 0 ? first : await listUnresolvedClipJobs(env, CLIP_SWEEP_PAGE, offset);
  const out: ClipSweepResult = { total: page.total, listed: page.ids.length, advanced: 0, busy: 0, not_standalone: 0, missing: 0, failed: 0 };
  for (const id of page.ids) {
    try {
      // A clips-* row is written only for a standalone job; the marker is the proof, so check it.
      if (!(await isStandaloneClipJob(env, id))) { out.not_standalone += 1; continue; }
      const leased = await withClipJobLease(env, id, () => advanceClipJob(env, id), { ensureRow: () => ensureClipJobRow(env, id) });
      if (!leased.ran) { out.busy += 1; continue; }
      if (!leased.value) { out.missing += 1; continue; }
      await updateRenderFromView(env, clipJobToPollView(leased.value));
      out.advanced += 1;
    } catch (e) {
      out.failed += 1;
      console.warn(JSON.stringify({ ev: "clips.sweep_job_failed", job_id: id, reason: e instanceof Error ? e.message : String(e) }));
    }
  }
  console.log(JSON.stringify({ ev: "clips.sweep", ...out }));
  return out;
}
