# Roadmap

## Phase 1 -- Prove Option B (vivijure-local v0.1.x)

**Goal:** Homelab operator can run the studio control plane without any Cloudflare account. Same UI, same API, local GPU door works.

| Milestone | Deliverable |
|-----------|-------------|
| M0 | Repo scaffold, platform interfaces, compose skeleton | done |
| M1 | SQLite + migrations applied; `GET /health`, `GET /api/whoami` + auth gate | done |
| M2 | Object store + `GET /api/artifact/*`, `POST /api/upload` | done |
| M3 | Projects, cast, prefs CRUD | done |
| M4 | `GET /api/modules` with HTTP sidecar discovery | done |
| M5 | Film submit/poll (`POST /api/storyboard/render`, poll loop) with `local-gpu` | done |
| M6 | CPU container chain (finish, beat-sync, mux, master) + unified `docker compose` | partial |
| M7 | Planner + preflight (BYOK or mock) | done |
| M8 | Parity gate: upstream conformance + vitest subset green |

**Exit criterion:** Crew demo -- planner -> render -> poll -> download MP4 on a box with no CF bindings.

## Phase 2 -- Harden local edition (v0.2.x)

- Optional cloud modules behind install profiles (RunPod `own-gpu`, provider i2v)
- MinIO vs filesystem storage toggle documented and tested
- Observability: structured render events to stdout (port `render-log.ts` channel)

## Phase 3 -- vivijure v2.0 / Option A (shared core)

**Goal:** One orchestration codebase, two hosts.

```
vivijure-core@2.x          # registry, film-orchestrator, types, conformance
vivijure@2.x               # CloudflarePlatform host (thin)
vivijure-local@2.x         # NodePlatform host (thin)
```

### Extraction steps

1. Freeze `Platform` interface (proven by local v1)
2. Move `src/modules/*`, `film-orchestrator.ts`, `render-orchestrator.ts`, DB helpers into `vivijure-core`
3. Replace `env.DB` / `env.R2_*` call sites with `platform.*` in core (mechanical)
4. vivijure Worker becomes binding shim (~`src/host/cloudflare.ts`)
5. vivijure-local deletes forked copies, depends on `vivijure-core`
6. Single conformance + vitest suite published from core; both hosts run it in CI

### v2.0 release semantics

- **vivijure 2.0.0** -- CF host on shared core; no user-facing API breaks (`vivijure-module/2` unchanged)
- **vivijure-local 2.0.0** -- Node host on same core; parity checklist fully green
- CONTRACT.md remains in `vivijure` repo as canonical ICD; vivijure-local links to it until doc packaging merges

## Non-goals (v1)

- Workers for Platforms / hot module install
- CF Access auth mode
- Tail consumer -> Loki (stdout only in v1)
- Rewriting module workers in non-TS stacks

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-11 | Option B first (fork-adapt), Option A at vivijure v2.0 (Conrad) |
