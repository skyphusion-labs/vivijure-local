# vivijure-core extraction inventory

Files to move from `vivijure-local/src/` into `@skyphusion-labs/vivijure-core`, grouped by wave.
Line counts are approximate guides for sizing PRs (run `wc -l` before each wave).

## Wave 0 -- dependency-free (first package publish)

| File | Notes |
|------|-------|
| `modules/types.ts` | Verbatim with `vivijure` `main`; module contract |
| `modules/conformance.ts` | Hook/manifest validation |
| `structured-events.ts` | Stdout `ev` JSON lines |
| `beat-sync-types.ts` | Planner analyze types (upstream: `modules/beat-sync/contract`) |

## Wave 1 -- module registry

| File | Notes |
|------|-------|
| `modules/registry.ts` | Discovery, invoke, poll; needs `Platform.modules` |
| `modules/render-pipeline.ts` | Render tier resolution |
| `modules/cpu/*-core.ts` | Pure CPU module logic (no fetch) |

## Wave 2 -- film model (pure + light imports)

| File | Notes |
|------|-------|
| `film-model.ts` | Types + sync helpers; decouple from `render-orchestrator` imports where possible |
| `storyboard-validate.ts` | Pure validation (split I/O if needed) |
| `finish-hash.ts`, `captions.ts`, `srt.ts` | Pure helpers |

## Wave 3 -- orchestrators (largest)

| File | Notes |
|------|-------|
| `film-orchestrator.ts` | Replace `Env` with `Platform` + presigner |
| `render-orchestrator.ts` | Same |
| `film-render-bridge.ts` | Poll view mapping |
| `clip-validate.ts`, `clip-content-validate.ts` | Validation gates |
| `bundle-assembler.ts`, `bundle-durations.ts` | Bundle path |

## Wave 4 -- persistence helpers

| File | Notes |
|------|-------|
| `renders-db.ts`, `cast-db.ts`, `storyboard-projects-db.ts` | `platform.db` only |
| `render-log.ts` | Artifact text logs for History UI |

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
