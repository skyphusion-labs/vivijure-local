# vivijure-core extraction inventory

Files moved from `vivijure-local/src/` into the sibling repo
[`vivijure-core`](https://github.com/skyphusion-labs/vivijure-core), grouped by wave.

Full status: `../vivijure-core/docs/EXTRACTION-STATUS.md`.
Line counts are approximate guides for sizing PRs (run `wc -l` before each wave).

## Wave 0 -- dependency-free (first package publish) **DONE**

| File | Location | Notes |
|------|----------|-------|
| `modules/types.ts` | `vivijure-core/src/modules/` | Verbatim with `vivijure` `main`; module contract |
| `modules/conformance.ts` | `vivijure-core/src/modules/` | Hook/manifest validation |
| `modules/manifest-validate.ts` | `vivijure-core/src/modules/` | Pure `validateManifest` (split from registry for wave 0) |
| `structured-events.ts` | `vivijure-core/src/` | Stdout `ev` JSON lines |
| `beat-sync-types.ts` | `vivijure-core/src/` | Planner analyze types (upstream: `modules/beat-sync/contract`) |

Host imports via `@skyphusion-labs/vivijure-core`. Upstream verbatim parity:
`vivijure-core/src/modules/types.ts`.

## Wave 1 -- module registry **DONE**

| File | Location | Notes |
|------|----------|-------|
| `modules/registry.ts` | `vivijure-core/src/modules/` | Discovery, invoke, poll |
| `modules/render-pipeline.ts` | `vivijure-core/src/modules/` | Render tier resolution |

## Wave 2 -- film model (pure) **DONE (M17)**

| File | Location | Notes |
|------|----------|-------|
| `film-model.ts` | `vivijure-core/src/` | Pure shapes + sync logic |
| `clip-job-model.ts` | `vivijure-core/src/` | ClipJob types + `summarizeJob` (split for decoupling) |
| `storyboard-ids.ts` | `vivijure-core/src/` | `coerceShotId` |

Host re-exports film-model via `@skyphusion-labs/vivijure-core/film-model` from `film-orchestrator.ts`.

## Wave 2 -- planner pure helpers **DONE (M21)**

| File | Location | Notes |
|------|----------|-------|
| `preflight.ts` | `vivijure-core/src/` | Shape/cast/duration-grid checks; `#751` floor escalation |
| `planner-prompt.ts` | `vivijure-core/src/` | Plan/refine prompt builders + JSON fence strip |
| `output-extract.ts` | `vivijure-core/src/` | LLM response normalization |

Host `src/{preflight,planner-prompt,output-extract}.ts` are re-export shims. Preflight route passes `resolveClipDurationFloor` from `film-model`.

## Wave 2 -- remaining pure helpers **DONE (M20)**

| File | Location | Notes |
|------|----------|-------|
| `key-safety.ts` | `vivijure-core/src/` | `isSafeRelKey`, `sanitizeKeySegment`, bundle key prefix |
| `storyboard-validate.ts` | `vivijure-core/src/` | Planner output validator |
| `planner-yaml.ts` | `vivijure-core/src/` | YAML emit + scene parse; `parseShotDurations` re-exports `shot-durations-parse` |
| `tar.ts` | `vivijure-core/src/` | POSIX ustar read + emit |
| `bundle-assembler.ts` | `vivijure-core/src/` | `.tar.gz` assembly + keyframe overlay |
| `bundle-durations.ts` | `vivijure-core/src/` | `gzipBytes`, `gunzipBytes`, `readShotDurationsFromBundle` |

Host `src/{bundle-assembler,storyboard-validate,planner-yaml,tar-emit}.ts` are re-export shims.

## Wave 4 -- persistence helpers **DONE**

| File | Location | Notes |
|------|----------|-------|
| `public-id.ts`, `db-env.ts` | `vivijure-core/src/` | Public id mint/validate; `DbEnv` (`{ DB }`) |
| `cast-db.ts`, `storyboard-projects-db.ts` | `vivijure-core/src/` | Cast + project CRUD on `platform.db` |
| `renders-db.ts`, `render-log.ts` | `vivijure-core/src/` | Render history rows + R2 log artifacts |
| `cast-lora-db.ts` | (removed) | Folded into `cast-db.ts` (`film-orchestrator` import) |

Host `src/*-db.ts` files are re-export shims. `platform-secrets-db.ts` stays host-only (Node settings store).

## Wave 3 -- orchestrators (largest) **DONE**

| File | Location | Status | Notes |
|------|----------|--------|-------|
| `platform/r2-types.ts`, `object-store-r2.ts`, `orchestrator-context.ts` | `vivijure-core/src/platform/` | done | R2 shim + `orchestratorContextFromPlatform` (env bridge in core) |
| `render-orchestrator.ts` | `vivijure-core/src/` | done | Host re-exports `@skyphusion-labs/vivijure-core/render-orchestrator` |
| `clip-validate.ts` | `vivijure-core/src/` | done | Structural mp4 gate |
| `film-orchestrator.ts` | `vivijure-core/src/` | done | ~2.2k lines; host re-exports `@skyphusion-labs/vivijure-core/film-orchestrator` |
| `film-render-bridge.ts` | `vivijure-core/src/` | done | Poll view + row seed; host maps `FilmRenderRowSeed` → `renders-db` |
| `render-module-config.ts` | `vivijure-core/src/` | done | Quality tiers + override resolution |
| `runpod-types.ts` | `vivijure-core/src/` | done | Planner poll contract types |
| `clip-content-validate.ts` | `vivijure-core/src/` | done | Layer 2 pixel gate (CPU container) |

Host VPC injection lives on `Platform.hostBindings`; routes call `orchestratorContextFromPlatform` from core.
Core CI: `vivijure-core/tests/{platform-contract,conformance,db-helpers,bundle-assembler,preflight}.test.ts`.

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
