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

**Goal:** Optional cloud/satellite modules, storage modes documented and tested, stdout observability. **M9–M12 done** (v0.2.0 hardening slice).

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| M9 | MinIO vs `ARTIFACT_ROOT` factory tests; install profile docs; `/health` storage field | done |
| M10 | `structured-events.ts`; `film.phase` / terminal events; [observability.md](observability.md) | done |
| M11 | Compose `satellites` profile for finish sidecars; [install-profiles.md](install-profiles.md) | done |
| M12 | CI `upstream-parity` workflow: diff `public/` vs `vivijure` main (`--verbatim` for migrations/types locally) | done |

- Optional cloud modules behind install profiles (RunPod `own-gpu`, provider i2v)
- MinIO vs filesystem storage toggle documented and tested
- Observability: structured render events to stdout (`emitStructuredEvent`; History text logs stay in `render-log.ts`)

## Phase 3 -- vivijure v2.0 / Option A (shared core)

**Goal:** One orchestration codebase, two hosts. Detail: [PHASE3.md](PHASE3.md).

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| M13 | Freeze Platform ICD (`docs/PLATFORM.md`, contract tests) | in progress |
| M14 | `vivijure-core` standalone repo | done |
| M15 | Extraction inventory (`docs/core-extraction-inventory.md`) | in progress |
| M16 | Wave 0 into package (`types`, conformance, structured-events, beat-sync-types) | done |
| M17 | Registry + film-model in core; hosts depend on package | done |
| M18 | Orchestrators in core; env bridge removed | done |
| M19 | DB helpers (`cast-db`, `renders-db`, `storyboard-projects-db`, `render-log`) in core | done |
| M20 | Bundle assembly (`bundle-assembler`, `storyboard-validate`, `planner-yaml`, `tar`) in core | done |
| M21 | Planner pure helpers (`preflight`, `planner-prompt`, `output-extract`) in core | done |

```
vivijure-core@2.x          # registry, film-orchestrator, types, conformance
vivijure@2.x               # CloudflarePlatform host (thin)
vivijure-local@2.x         # NodePlatform host (thin)
```

### Extraction steps

1. Freeze `Platform` interface (proven by local v1) -- **M13**
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
