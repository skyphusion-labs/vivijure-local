// local#530: one advancer at a time for a standalone clip job. Ported from vivijure-cf
// src/clip-job-lease.ts (cf#1315).
//
// Two drivers now advance a standalone clip job: its GET and the render sweep. advanceClipJob buys
// the next batch, and the object store has no conditional put, so two advances that both read the doc
// before either batch claim landed could each buy the same batch. The guard is core's film advance
// lease, keyed by the clip job id: a conditional UPDATE on the renders row (migrations 0007 and 0012),
// which a standalone clip job has. A caller that loses the lease does not advance; the holder is.
//
// THE MISSING ROW. The lease fails OPEN when no row exists, so a legacy job cannot deadlock. A
// standalone job's row can be missing when the start's best-effort insert failed, so the caller
// passes `ensureRow`: on a claim that won with no token, the row is written and the claim asked again.

import type { ClipJob } from "@skyphusion-labs/vivijure-core/render-orchestrator";
import { clipJobDocKey } from "@skyphusion-labs/vivijure-core/film-model";
import {
  claimFilmAdvance,
  holdFilmAdvance,
  insertRender,
  releaseFilmAdvance,
  type FilmAdvanceClaim,
} from "@skyphusion-labs/vivijure-core/renders-db";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";
import { clipJobRowSeed } from "./clip-job-row.js";

export type ClipJobLeaseOutcome<T> = { ran: true; value: T } | { ran: false };

async function claimOrFailOpen(env: OrchestratorEnv, jobId: string): Promise<FilmAdvanceClaim> {
  try {
    return await claimFilmAdvance(env, jobId);
  } catch (e) {
    // The film tick's posture: a lease that cannot be asked does not stop the work.
    console.warn(JSON.stringify({ ev: "clips.lease_unavailable", job_id: jobId, reason: e instanceof Error ? e.message : String(e) }));
    return { won: true };
  }
}

/** Run `fn` only while holding the clip job's lease; { ran: false } when another driver holds it. */
export async function withClipJobLease<T>(
  env: OrchestratorEnv,
  jobId: string,
  fn: () => Promise<T>,
  opts: { ensureRow?: () => Promise<void> } = {},
): Promise<ClipJobLeaseOutcome<T>> {
  let claim = await claimOrFailOpen(env, jobId);
  if (claim.won && claim.token === undefined && opts.ensureRow) {
    await opts.ensureRow();
    claim = await claimOrFailOpen(env, jobId);
  }
  if (!claim.won) return { ran: false };
  const hold = holdFilmAdvance(env, jobId, claim);
  try {
    return { ran: true, value: await fn() };
  } finally {
    hold.stop();
    if (claim.token !== undefined) {
      await releaseFilmAdvance(env, jobId, claim.token).catch((e: unknown) => {
        // Not fatal: the lease expires on its own within its TTL.
        console.warn(JSON.stringify({ ev: "clips.lease_release_failed", job_id: jobId, reason: e instanceof Error ? e.message : String(e) }));
      });
    }
  }
}

/** The clip job doc as stored, without advancing it. Null when there is none. */
export async function readClipJobDoc(env: OrchestratorEnv, jobId: string): Promise<ClipJob | null> {
  const obj = await env.R2_RENDERS.get(clipJobDocKey(jobId));
  if (!obj) return null;
  return JSON.parse(await obj.text()) as ClipJob;
}

/** Write a standalone job's renders row if it is missing, so its lease has a row to hold. */
export async function ensureClipJobRow(env: OrchestratorEnv, jobId: string): Promise<void> {
  const job = await readClipJobDoc(env, jobId);
  if (job) await insertRender(env, clipJobRowSeed(job)); // false on conflict: the row was already there
}
