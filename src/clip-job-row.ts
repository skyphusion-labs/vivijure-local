// local#530: a standalone clip job (POST /api/render/clips) gets a renders row and an owner marker,
// so the render sweep can find it and drive it. Ported from vivijure-cf src/clip-job-row.ts
// (cf#1309), the studio's twin of this door.
//
// WHY. Since vivijure-core 1.35.0 (core#451) a clip job is bought in claimed batches of
// CLIP_SUBMIT_BATCH (20) shots: startClipJob buys the first batch, and each later batch is bought by
// advanceClipJob. Core's render sweep drives only film-* and scatter-* jobs it finds through renders
// rows, and before this a standalone clip job had no row, so only its own GET advanced it. A job of
// more than 20 shots that nobody polled stopped after 20.
//
// ORDER at the start, each step failing toward KEEP:
//   1. renders/<clips-id>/clips-job.json   startClipJob (core);
//   2. renders/<clips-id>/owner.json       the owner marker (clipJobOwnerKey): proof the job was born
//                                          standalone, so the sweep never drives a film's clip job;
//   3. the renders row                     job_id = the clips id, mode "clips" (core 1.41.0+).
// A crash after 1 leaves a job only its own GET drives (the old behaviour). A crash after 2 leaves a
// marked job with no row; its next GET inserts the row.

import type { ClipJob } from "@skyphusion-labs/vivijure-core/render-orchestrator";
import { describeClipFailures } from "@skyphusion-labs/vivijure-core/render-orchestrator";
import { summarizeJob } from "@skyphusion-labs/vivijure-core/clip-job-model";
import type { NewRenderRow } from "@skyphusion-labs/vivijure-core/renders-db";
import type { RunpodJobView, RunpodStatus } from "@skyphusion-labs/vivijure-core/runpod-types";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";

/** The row mode, and the poll view's output.mode, so updateRenderFromView keeps the column. */
export const CLIP_JOB_MODE = "clips" as const;

/** The owner marker key, the same name vivijure-cf uses. */
export function clipJobOwnerKey(clipJobId: string): string {
  return `renders/${clipJobId}/owner.json`;
}

/** A clip job's status in the renders row's RunPod vocabulary. Complete with no clip: FAILED. */
export function clipJobStatus(job: ClipJob): RunpodStatus {
  const s = summarizeJob(job);
  if (!s.complete) return "IN_PROGRESS";
  return s.done === 0 ? "FAILED" : "COMPLETED";
}

/** The renders row a standalone clip job is inserted with. A clip job has no bundle and no tier. */
export function clipJobRowSeed(job: ClipJob): NewRenderRow {
  return {
    jobId: job.job_id,
    project: job.project,
    bundleKey: "",
    qualityTier: "final",
    status: clipJobStatus(job),
    mode: CLIP_JOB_MODE,
    motionBackend: job.motion_backend ?? null,
  };
}

/** The poll view that keeps the row current: every finished clip, and the failed shots named. */
export function clipJobToPollView(job: ClipJob): RunpodJobView {
  const status = clipJobStatus(job);
  const clips = job.shots
    .filter((sh) => sh.status === "done" && typeof sh.clip_key === "string" && sh.clip_key.length > 0)
    .map((sh) => ({ shot_id: sh.shot_id, key: sh.clip_key as string, model: sh.motion_backend ?? job.motion_backend ?? null }));
  const failures = describeClipFailures(job);
  return {
    jobId: job.job_id,
    status,
    statusRaw: status,
    output: { mode: CLIP_JOB_MODE, clips, summary: summarizeJob(job) },
    ...(status !== "IN_PROGRESS" && failures ? { error: failures } : {}),
  };
}

export async function writeClipJobOwner(env: OrchestratorEnv, jobId: string): Promise<void> {
  await env.R2_RENDERS.put(clipJobOwnerKey(jobId), JSON.stringify({ kind: "standalone-clip-job", job_id: jobId }), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** True when the job was born standalone (it carries the owner marker). */
export async function isStandaloneClipJob(env: OrchestratorEnv, jobId: string): Promise<boolean> {
  return (await env.R2_RENDERS.head(clipJobOwnerKey(jobId))) !== null;
}
