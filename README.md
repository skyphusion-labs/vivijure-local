# Vivijure Local

Provider-neutral edition of [Vivijure Studio](https://github.com/skyphusion-labs/vivijure): the same modular AI film control plane and reference API (`docs/CONTRACT.md` in the upstream repo), without Cloudflare Workers, D1, R2, or Workers AI.

GPU render backends (`vivijure-backend` on RunPod, `vivijure-local-12gb` / `-16gb` on your own card) are unchanged. This repo swaps only the **host**.

## Strategy

| Phase | Goal |
|-------|------|
| **v1 (this repo, Option B)** | Fork-adapt the vivijure core onto Node + SQLite + object storage. Prove full CONTRACT parity on a homelab stack. |
| **v2 (vivijure 2.0, Option A)** | Extract shared orchestration into `vivijure-core`; both `vivijure` (CF) and `vivijure-local` become thin host adapters. |

See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`.

## Quick start

### One-command Docker stack (recommended)

Studio, MinIO, CPU media containers, and module manifest sidecars in a single `compose.yaml`:

```bash
cp .env.example .env          # set STUDIO_API_TOKEN
npm run compose:up            # docker compose up -d --build
curl -fsS http://127.0.0.1:8790/health
```

| Service | URL |
|---------|-----|
| Studio API + UI | http://127.0.0.1:8790 |
| MinIO API | http://127.0.0.1:9000 |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |
| CPU media | http://127.0.0.1:8780-8784 (`/health`) |

**GPU (`local-gpu`)** is not in compose (Mac / no GPU in Docker). Run your GPU sidecar on the **host** at `:9102`, or point `MODULE_LOCAL_GPU_URL` at RunPod / `vivijure-backend`. Compose sets `MODULE_LOCAL_GPU_URL=http://host.docker.internal:9102` for the studio container.

```bash
# optional: host-native dev instead of containerized studio
npm install && npm run dev
```

Stop: `npm run compose:down`

### Host-native dev (no Docker studio)

```bash
cp .env.example .env
docker compose up -d          # MinIO + CPU media only (or full stack above)
npm install
npm run typecheck
npm run dev                   # studio API + UI (default :8790)
```

Full render path needs CPU containers, module sidecars, and a GPU backend. See `docs/ARCHITECTURE.md`.

### Module catalog dev (M4)

Sidecars speak HTTP instead of CF service bindings. Sync manifests from a sibling `vivijure` clone, start the fleet, source env, then run the studio:

```bash
npm run module-manifests          # writes dev/manifests/*.json from ../vivijure
npm run module-fleet              # manifest-only sidecars on :9101+
set -a; source dev/module-fleet.env; set +a
npm run dev
npm run module-fleet:stop         # when done
```

Or set `MODULE_KEYFRAME_URL`, `MODULE_LOCAL_GPU_URL`, etc. in `.env` manually (see `.env.example`).

**M5 render path:** `POST /api/storyboard/render` starts a `film-*` job (keyframe then `local-gpu` motion when modules are bound). Poll with `GET /api/storyboard/render/:jobId`. Job state lives in object storage; history rows land in SQLite `renders`.

## What is copied verbatim from vivijure

- `public/` -- planner / cast / settings UI (projection from `GET /api/modules`)
- `migrations/` -- SQLite schema (D1-compatible SQL)
- `src/modules/types.ts` -- `vivijure-module/2` contract (dependency-free)

Object storage defaults to **MinIO** (S3-compatible). Set `S3_*` in `.env`; R2 or AWS S3 later is a config swap.

Everything else is ported behind `src/platform/` adapters.

## License

AGPL-3.0-only (same as vivijure).
