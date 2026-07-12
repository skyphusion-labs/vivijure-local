# Vivijure Local

Provider-neutral edition of [Vivijure Studio](https://github.com/skyphusion-labs/vivijure): the same modular AI film control plane and reference API (`docs/CONTRACT.md` in the upstream repo), without Cloudflare Workers, D1, R2, or Workers AI.

GPU render backends (`vivijure-backend` on RunPod, `vivijure-local-12gb` / `-16gb` on your own card) are unchanged. This repo swaps only the **host**.

## Strategy

| Phase | Goal |
|-------|------|
| **v1 (this repo, Option B)** | Fork-adapt the vivijure core onto Node + SQLite + object storage. Prove full CONTRACT parity on a homelab stack. |
| **v2 (vivijure 2.0, Option A)** | Extract shared orchestration into `vivijure-core`; both `vivijure` (CF) and `vivijure-local` become thin host adapters. |

See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`.

## Quick start (scaffold)

```bash
cp .env.example .env
docker compose up -d          # MinIO + CPU media containers
npm install
npm run typecheck
npm run dev                   # studio API + UI (default :8790)
```

Full render path requires CPU containers (`compose.yaml`), module sidecars, and a GPU backend. See `docs/ARCHITECTURE.md`.

## What is copied verbatim from vivijure

- `public/` -- planner / cast / settings UI (projection from `GET /api/modules`)
- `migrations/` -- SQLite schema (D1-compatible SQL)
- `src/modules/types.ts` -- `vivijure-module/2` contract (dependency-free)

Object storage defaults to **MinIO** (S3-compatible). Set `S3_*` in `.env`; R2 or AWS S3 later is a config swap.

Everything else is ported behind `src/platform/` adapters.

## License

AGPL-3.0-only (same as vivijure).
