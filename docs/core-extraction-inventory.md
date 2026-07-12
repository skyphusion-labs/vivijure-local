# vivijure-core extraction inventory

Files to move from `vivijure-local/src/` into `@skyphusion-labs/vivijure-core`, grouped by wave.
Line counts are approximate guides for sizing PRs (run `wc -l` before each wave).

## Wave 0 -- dependency-free (first package publish) **DONE**

| File | Location | Notes |
|------|----------|-------|
| `modules/types.ts` | `packages/vivijure-core/src/modules/` | Verbatim with `vivijure` `main`; module contract |
| `modules/conformance.ts` | `packages/vivijure-core/src/modules/` | Hook/manifest validation |
| `modules/manifest-validate.ts` | `packages/vivijure-core/src/modules/` | Pure `validateManifest` (split from registry for wave 0) |
| `structured-events.ts` | `packages/vivijure-core/src/` | Stdout `ev` JSON lines |
| `beat-sync-types.ts` | `packages/vivijure-core/src/` | Planner analyze types (upstream: `modules/beat-sync/contract`) |

Host imports via `@skyphusion-labs/vivijure-core`. Upstream verbatim parity:
`packages/vivijure-core/src/modules/types.ts`.

## Wave 1 -- module registry **DONE**

| File | Location | Notes |
|------|----------|-------|
| `modules/registry.ts` | `packages/vivijure-core/src/modules/` | Discovery, invoke, poll |
| `modules/render-pipeline.ts` | `packages/vivijure-core/src/modules/` | Render tier resolution |

## Wave 2 -- film model (pure) **DONE (M17)**

| File | Location | Notes |
|------|----------|-------|
| `film-model.ts` | `packages/vivijure-core/src/` | Pure shapes + sync logic |
| `clip-job-model.ts` | `packages/vivijure-core/src/` | ClipJob types + `summarizeJob` (split for decoupling) |
| `storyboard-ids.ts` | `packages/vivijure-core/src/` | `coerceShotId` |

Host re-exports film-model via `@skyphusion-labs/vivijure-core/film-model` from `film-orchestrator.ts`.

## Wave 2 -- planner pure helpers **DONE (M21)**

| File | Location | Notes |
|------|----------|-------|
| `preflight.ts` | `packages/vivijure-core/src/` | Shape/cast/duration-grid checks; `#751` floor escalation |
| `planner-prompt.ts` | `packages/vivijure-core/src/` | Plan/refine prompt builders + JSON fence strip |
| `output-extract.ts` | `packages/vivijure-core/src/` | LLM response normalization |

Host `src/{preflight,planner-prompt,output-extract}.ts` are re-export shims. Preflight route passes `resolveClipDurationFloor` from `film-model`.

## Wave 2 -- remaining pure helpers **DONE (M20)**

| File | Location | Notes |
|------|----------|-------|
| `key-safety.ts` | `packages/vivijure-core/src/` | `isSafeRelKey`, `sanitizeKeySegment`, bundle key prefix |
| `storyboard-validate.ts` | `packages/vivijure-core/src/` | Planner output validator |
| `planner-yaml.ts` | `packages/vivijure-core/src/` | YAML emit + scene parse; `parseShotDurations` re-exports `shot-durations-parse` |
| `tar.ts` | `packages/vivijure-core/src/` | POSIX ustar read + emit |
| `bundle-assembler.ts` | `packages/vivijure-core/src/` | `.tar.gz` assembly + keyframe overlay |
| `bundle-durations.ts` | `packages/vivijure-core/src/` | `gzipBytes`, `gunzipBytes`, `readShotDurationsFromBundle` |

Host `src/{bundle-assembler,storyboard-validate,planner-yaml,tar-emit}.ts` are re-export shims.

## Wave 4 -- persistence helpers **DONE**

| File | Location | Notes |
|------|----------|-------|
| `public-id.ts`, `db-env.ts` | `packages/vivijure-core/src/` | Public id mint/validate; `DbEnv` (`{ DB }`) |
| `cast-db.ts`, `storyboard-projects-db.ts` | `packages/vivijure-core/src/` | Cast + project CRUD on `platform.db` |
| `renders-db.ts`, `render-log.ts` | `packages/vivijure-core/src/` | Render history rows + R2 log artifacts |
| `cast-lora-db.ts` | (removed) | Folded into `cast-db.ts` (`film-orchestrator` import) |

Host `src/*-db.ts` files are re-export shims. `platform-secrets-db.ts` stays host-only (Node settings store).

## Wave 3 -- orchestrators (largest) **DONE**

| File | Location | Status | Notes |
|------|----------|--------|-------|
| `platform/r2-types.ts`, `object-store-r2.ts`, `orchestrator-context.ts` | `packages/vivijure-core/src/platform/` | done | R2 shim + `orchestratorContextFromPlatform` (env bridge in core) |
| `render-orchestrator.ts` | `packages/vivijure-core/src/` | done | Host re-exports `@skyphusion-labs/vivijure-core/render-orchestrator` |
| `clip-validate.ts` | `packages/vivijure-core/src/` | done | Structural mp4 gate |
| `film-orchestrator.ts` | `packages/vivijure-core/src/` | done | ~2.2k lines; host re-exports `@skyphusion-labs/vivijure-core/film-orchestrator` |
| `film-render-bridge.ts` | `packages/vivijure-core/src/` | done | Poll view + row seed; host maps `FilmRenderRowSeed` → `renders-db` |
| `render-module-config.ts` | `packages/vivijure-core/src/` | done | Quality tiers + override resolution |
| `runpod-types.ts` | `packages/vivijure-core/src/` | done | Planner poll contract types |
| `clip-content-validate.ts` | `packages/vivijure-core/src/` | done | Layer 2 pixel gate (CPU container) |

Host VPC injection lives on `Platform.hostBindings`; routes call `orchestratorContextFromPlatform` from core.
Core CI: `packages/vivijure-core/tests/{platform-contract,conformance,db-helpers,bundle-assembler,preflight}.test.ts`.

## Stays in vivijure-local (host)

| Area | Path |
|------|------|
| Platform ICD + adapters | `platform/types.ts` (until lifted), `sqlite.ts`, `s3-*`, `modules.ts`, `http-fetcher.ts`, ... |
| HTTP server | `server.ts`, `app.ts`, `routes/*` |
| Auth | `auth-gate.ts` |
| Node secrets / compose | `compose.yaml`, `containers/`, scripts |
| Operator docs | `docs/quickstart.md`, `DEPLOYMENT.md`, ... |
| UI | `public/` (synced from `vivijure` until shared packaging) |

## Stays in vivijure (CF host)

| Area | Path |
|------|------|
| Wrangler bindings shim | Future `src/host/cloudflare.ts` |
| `wrangler.toml`, deploy scripts | Unchanged |
| Tail / Loki | CF observability path |

## Progress tracking

Update this table as waves land. When a file moves to core, `vivijure-local` should import from
`@skyphusion-labs/vivijure-core` and delete the forked copy in the same PR.
