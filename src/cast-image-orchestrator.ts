// Cast-image orchestrator: drive the `cast.image` module to generate LoRA training refs.

import {
  discoverModules,
  invokeModule,
  pollModule,
  resolveFetcher,
  resolvePickOne,
  validateConfig,
  hookOutputViolation,
} from "@skyphusion-labs/vivijure-core";
import type { CastImageInput, CastImageOutput } from "@skyphusion-labs/vivijure-core/modules/types";
import { presignR2Get } from "@skyphusion-labs/vivijure-core/presign";
import {
  addRefs,
  getCastById,
  type CastRefImage,
} from "@skyphusion-labs/vivijure-core/cast-db";
import type { OrchestratorEnv } from "@skyphusion-labs/vivijure-core/platform";

export interface CastRefsJob {
  job_id: string;
  cast_id: number;
  cast_public_id: string;
  module_name: string | null;
  binding: string | null;
  phase: "generating" | "done" | "failed";
  module_poll?: string;
  images: CastRefImage[];
  applied: string[];
  registered: number;
  error?: string;
  created_at: number;
}

const REF_TTL = 1800;
const MAX_REFS = 4;

export const castRefsJobKey = (castId: number, jobId: string) =>
  `cast-gen/${castId}/${jobId}.refs-job.json`;

export function selectSeedKeys(
  portraitKey: string | null,
  sourceKeys: { key: string }[],
  wantKeys: string[] | undefined,
  max = MAX_REFS,
): string[] {
  const valid = new Set(sourceKeys.map((s) => s.key));
  const want = (wantKeys ?? []).filter((k) => valid.has(k));
  const out: string[] = [];
  if (portraitKey) out.push(portraitKey);
  for (const k of want) if (!out.includes(k)) out.push(k);
  return out.slice(0, max);
}

export interface CastRefsSummary {
  job_id: string;
  cast_id: string;
  phase: CastRefsJob["phase"];
  module?: string;
  registered: number;
  images: CastRefImage[];
  error?: string;
}

export function summarizeCastRefs(job: CastRefsJob): CastRefsSummary {
  return {
    job_id: job.job_id,
    cast_id: job.cast_public_id,
    phase: job.phase,
    module: job.module_name ?? undefined,
    registered: job.registered,
    images: job.images,
    error: job.error,
  };
}

const putJob = (env: OrchestratorEnv, job: CastRefsJob) =>
  env.R2_RENDERS.put(castRefsJobKey(job.cast_id, job.job_id), JSON.stringify(job), {
    httpMetadata: { contentType: "application/json" },
  });

async function finalize(env: OrchestratorEnv, job: CastRefsJob, output: CastImageOutput): Promise<void> {
  const imgs = (output.images || []).filter((i) => i && i.key && i.mime);
  job.images = imgs;
  job.applied = output.applied || [];
  if (imgs.length) {
    const row = await addRefs(env, job.cast_id, imgs);
    job.registered = row ? imgs.length : 0;
  }
  job.phase = "done";
}

export async function startCastRefsJob(
  env: OrchestratorEnv,
  args: {
    castId: number;
    config?: Record<string, unknown>;
    artStyle?: string;
    sourceKeys?: string[];
    choice?: string;
  },
): Promise<CastRefsJob | null> {
  const cast = await getCastById(env, args.castId);
  if (!cast) return null;

  const job: CastRefsJob = {
    job_id: "refs-" + crypto.randomUUID(),
    cast_id: args.castId,
    cast_public_id: cast.public_id,
    module_name: null,
    binding: null,
    phase: "generating",
    images: [],
    applied: [],
    registered: 0,
    created_at: Date.now(),
  };

  const seedKeys = selectSeedKeys(cast.portrait_key, cast.source_keys, args.sourceKeys);
  if (!seedKeys.length) {
    job.phase = "failed";
    job.error = "cast member has no portrait or source photo to generate from";
    await putJob(env, job);
    return job;
  }

  const envRec = env as unknown as Record<string, unknown>;
  const modules = await discoverModules(envRec);
  const module = resolvePickOne(modules, "cast.image", args.choice);
  if (!module) {
    job.phase = "failed";
    job.error = args.choice
      ? `no cast.image module named "${args.choice}"`
      : "no cast.image module installed";
    await putJob(env, job);
    return job;
  }
  job.module_name = module.name;
  job.binding = module.binding;
  const fetcher = resolveFetcher(envRec, module.binding);
  if (!fetcher) {
    job.phase = "failed";
    job.error = `cast.image module ${module.name} (${module.binding}) is not bound`;
    await putJob(env, job);
    return job;
  }

  const urls = await Promise.all(seedKeys.map((k) => presignR2Get(env, k, REF_TTL)));
  const input: CastImageInput = {
    cast_id: args.castId,
    portrait_url: urls[0],
    portrait_key: seedKeys[0],
    source_urls: urls.slice(1),
    bible: cast.bible ?? undefined,
    art_style: args.artStyle,
  };
  const config = validateConfig(module.config_schema, args.config);
  const r = await invokeModule<CastImageInput, CastImageOutput>(fetcher, {
    hook: "cast.image",
    input,
    config,
    context: { project: `cast-${args.castId}`, job_id: job.job_id },
  });
  if (!r.ok) {
    job.phase = "failed";
    job.error = r.error;
  } else if ((r as { pending?: boolean }).pending) {
    job.module_poll = (r as { poll: string }).poll;
  } else if ("output" in r) {
    const out = (r as { output: CastImageOutput }).output;
    const violation = hookOutputViolation(module.name, "cast.image", out);
    if (violation) {
      job.phase = "failed";
      job.error = violation;
    } else await finalize(env, job, out);
  } else {
    job.phase = "failed";
    job.error = "cast.image module returned neither output nor a poll token";
  }

  await putJob(env, job);
  return job;
}

export async function advanceCastRefsJob(
  env: OrchestratorEnv,
  castId: number,
  jobId: string,
): Promise<CastRefsJob | null> {
  const obj = await env.R2_RENDERS.get(castRefsJobKey(castId, jobId));
  if (!obj) return null;
  const job = JSON.parse(await obj.text()) as CastRefsJob;
  if (job.phase !== "generating" || !job.module_poll || !job.binding) return job;

  const envRec = env as unknown as Record<string, unknown>;
  const fetcher = resolveFetcher(envRec, job.binding);
  if (!fetcher) {
    job.phase = "failed";
    job.error = "cast.image module no longer bound";
    await putJob(env, job);
    return job;
  }
  const p = await pollModule<CastImageOutput>(fetcher, { poll: job.module_poll });
  if (!p.ok) {
    job.phase = "failed";
    job.error = p.error;
  } else if (!(p as { pending?: boolean }).pending) {
    const out = (p as { output: CastImageOutput }).output;
    const violation = hookOutputViolation(job.module_name ?? "cast.image", "cast.image", out);
    if (violation) {
      job.phase = "failed";
      job.error = violation;
    } else await finalize(env, job, out);
  }
  await putJob(env, job);
  return job;
}
