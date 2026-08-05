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
| M6 | CPU container chain (finish, beat-sync, mux, master) + unified `docker compose` | done |
| M7 | Planner + preflight (BYOK or mock) | done |
| M8 | Parity gate: upstream conformance + vitest subset green | done |

**Exit criterion:** Crew demo -- planner -> render -> poll -> download MP4 on a box with no CF bindings. **Done** (`npm run smoke:exit`).

## Phase 1 documentation

| Doc | Status |
|-----|--------|
| [quickstart.md](quickstart.md) | Homelab quick path |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Operator reference |
| [SECURITY.md](SECURITY.md) | Token auth model |
| [constellation.md](constellation.md) | Vivijure map (local host) |

## Phase 2 -- Harden local edition (v0.2.x)

**Goal:** Optional cloud/satellite modules, storage modes documented and tested, stdout observability. **M9-M12 done** (v0.2.0 hardening slice).

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| M9 | MinIO vs `ARTIFACT_ROOT` factory tests; install profile docs; `/health` storage field | done |
| M10 | `structured-events.ts`; `film.phase` / terminal events; [observability.md](observability.md) | done |
| M11 | Compose `satellites` profile for finish sidecars; [install-profiles.md](install-profiles.md) | done |
| M12 | CI `upstream-parity` workflow: diff `public/` vs `vivijure` main | done, then RETIRED (local#263) |

- Optional cloud modules behind install profiles (RunPod `own-gpu`, provider i2v)
- MinIO vs filesystem storage toggle documented and tested
- Observability: structured render events to stdout (`emitStructuredEvent`; History text logs stay in `render-log.ts`)

## Phase 3 -- shared core extraction (DONE / historical)

**Status: complete.** Orchestration lives in published `@skyphusion-labs/vivijure-core`; both
hosts consume it. Detail: [PHASE3.md](PHASE3.md) (milestones marked done) and core
`docs/HOST-ADOPTION.md` / `docs/EXTRACTION-STATUS.md`.

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| M13 | Freeze Platform ICD (`docs/PLATFORM.md`, contract tests) | done |
| M14 | `vivijure-core` standalone repo | done |
| M15 | Extraction inventory (`docs/core-extraction-inventory.md`) | done |
| M16 | Wave 0 into package (`types`, conformance, structured-events, beat-sync-types) | done |
| M17 | Registry + film-model in core; hosts depend on package | done |
| M18 | Orchestrators in core; env bridge removed | done |
| M19 | DB helpers (`cast-db`, `renders-db`, `storyboard-projects-db`, `render-log`) in core | done |
| M20 | Bundle assembly (`bundle-assembler`, `storyboard-validate`, `planner-yaml`, `tar`) in core | done |
| M21 | Planner pure helpers (`preflight`, `planner-prompt`, `output-extract`) in core | done |

```
@skyphusion-labs/vivijure-core   # registry, film-orchestrator, types, conformance (npm)
vivijure-cf                      # Cloudflare host (thin)
vivijure-local                   # Node host (thin)
```

Remaining work is ordinary dual-panel product shipping and pin currency, not extraction.

## Non-goals (v1)

- Workers for Platforms / hot module install
- CF Access auth mode
- Tail consumer -> Loki (stdout only in v1)
- Rewriting module workers in non-TS stacks

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-11 | Option B first (fork-adapt), Option A at vivijure v2.0 (Conrad) |
