# @skyphusion-labs/vivijure-core

Shared Vivijure orchestration for:

- [`vivijure`](https://github.com/skyphusion-labs/vivijure) (Cloudflare Workers host)
- [`vivijure-local`](https://github.com/skyphusion-labs/vivijure-local) (Node homelab host)

Plan: [docs/PHASE3.md](../../docs/PHASE3.md) · Inventory: [docs/core-extraction-inventory.md](../../docs/core-extraction-inventory.md)

## Exports

| Entry | Contents |
|-------|----------|
| `@skyphusion-labs/vivijure-core` | Platform ICD, module contract, registry, render-orchestrator, conformance, ... |
| `@skyphusion-labs/vivijure-core/platform` | Platform ICD, R2 shim, `orchestratorContextFromPlatform` |
| `@skyphusion-labs/vivijure-core/film-model` | Pure film model (re-exported by host orchestrators) |
| `@skyphusion-labs/vivijure-core/render-orchestrator` | Clip job orchestration (motion.backend) |
| `@skyphusion-labs/vivijure-core/cast-db` | Cast CRUD (`DbEnv` / `platform.db`) |
| `@skyphusion-labs/vivijure-core/renders-db` | Render history rows + film-advance lease re-exports |

## Status

| Wave | Content | Status |
|------|---------|--------|
| Platform ICD | `platform/types.ts` | synced via `npm run sync:platform-icd` |
| Wave 0 | types, conformance, structured-events, beat-sync-types | **done** |
| Wave 1 | registry, render-pipeline | **done** |
| Wave 2 | film-model, clip-job-model, storyboard-ids | **done** |
| Wave 3 | orchestrators, film-render-bridge, render-module-config | **done** |
| Wave 4 | cast-db, storyboard-projects-db, renders-db, render-log, public-id | **done** |

CI: `npm run test -w @skyphusion-labs/vivijure-core` (platform ICD + conformance).

Module contract parity: `src/modules/types.ts` verbatim with `vivijure` `main`.
