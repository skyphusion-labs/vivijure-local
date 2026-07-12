export * from "@skyphusion-labs/vivijure-core/film-render-bridge";

import type { FilmJob } from "@skyphusion-labs/vivijure-core/film-orchestrator";
import {
  filmRenderRowSeedFromJob,
  type FilmRenderRowSeed,
} from "@skyphusion-labs/vivijure-core/film-render-bridge";
import type { NewRenderRow } from "./renders-db.js";

/** Map core film row seed into the host renders-table insert shape. */
export function filmRowFromJob(job: FilmJob): NewRenderRow {
  const seed: FilmRenderRowSeed = filmRenderRowSeedFromJob(job);
  return {
    jobId: seed.jobId,
    project: seed.project,
    bundleKey: seed.bundleKey,
    qualityTier: seed.qualityTier,
    status: seed.status,
    mode: seed.mode,
    parentId: seed.parentId,
  };
}
