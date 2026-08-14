# Architecture -- vivijure-local

Provider-neutral host for Vivijure Studio. Cloudflare-hosted reference: `vivijure-cf` on Cloudflare Workers.

Operator docs: [quickstart.md](quickstart.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [SECURITY.md](SECURITY.md) · [constellation.md](constellation.md).

> Shared orchestration already lives in **`@skyphusion-labs/vivijure-core`** (published npm dep).
> This host is a thin Node adapter: HTTP router, `src/platform/*`, compose, and operator surface.
> See [ROADMAP.md](ROADMAP.md) Phase 3 (historical) and core's `docs/HOST-ADOPTION.md`.

## Design principle

The film pipeline and module registry are **host-agnostic** and already published as
`@skyphusion-labs/vivijure-core`. This repo implements `NodePlatform` (SQLite, S3/MinIO, HTTP
module sidecars) and routes; `vivijure-cf` implements the CF platform. Both import the same package.

```
                    +------------------+
                    |  public/ UI      |  (unchanged, projection from GET /api/modules)
                    +--------+---------+
                             |
                    +--------v---------+
                    |  HTTP router     |  src/server.ts + ported handlers from vivijure/src/index.ts
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
  +------v------+    +-------v-------+   +-------v--------+
  | Platform.db |    | Platform.store|   | Platform.modules|
  | (SQLite)    |    | (fs / MinIO)  |   | (HTTP fetchers) |
  +-------------+    +---------------+   +----------------+
         |                   |                   |
  migrations/           renders/<key>        MODULE_*_URL sidecars
```

## Platform interface

Canonical ICD: `@skyphusion-labs/vivijure-core/platform` (this host re-exports / implements under
`src/platform/`). Cloudflare `Env` becomes `CloudflarePlatform implements Platform`; this repo
implements `NodePlatform`.

| Adapter | Replaces (CF) | Implementation |
|---------|---------------|----------------|
| `Database` | D1 `env.DB` | `node:sqlite` (Node 22.5+), same SQL from `migrations/` |
| `ObjectStore` | `R2_RENDERS`, `R2` | **S3-compatible API** (MinIO default; R2/S3 = config swap) |
| `SecretStore` | Secrets Store + worker secrets | `.env` / chezmoi |
| `ModuleTransport` | Service bindings `MODULE_*` | HTTP `fetch` to sidecar URLs |
| `AIRouter` | `env.AI.run` + Gateway | Direct provider APIs (`vivijure/src/providers/*`) |
| `RateLimiter` | `SPEND_RATE_LIMITER` | In-memory token bucket (v1); Redis optional later |
| `Scheduler` | Cron `scheduled` | `setInterval (core sweepUnresolvedJobs)` calling render sweep |
| `StaticAssets` | Workers Assets | `Hono serveStatic` / Hono `serveStatic` on `public/` |

## Module transport

Production vivijure binds each module as a CF Worker (`MODULE_KEYFRAME`, etc.). Locally:

1. Each module runs as a small HTTP server exposing `/module.json`, `/invoke`, `/poll`, `/cancel`.
2. `ModuleTransport.resolve(binding)` returns a `FetcherLike` that POSTs to `process.env.MODULE_KEYFRAME_URL`.
3. Conformance suites from upstream run unchanged against the sidecar fleet.

**Local module profile (MVP):** modules required for an offline homelab render without cloud spend:

| Module | Sidecar port | Notes |
|--------|--------------|-------|
| `keyframe` or `local-gpu` door | 9101+ | Pick motion path |
| `local-gpu` | 9102 | `vivijure-local-12gb` (LTX) / `-16gb` (CogVideoX) -- different engines + duration_grid; see local#235 |
| `finish-lipsync`, `finish-upscale` | 911x | Optional polish chain (RIFE is RunPod/CF-only, not local) |
| `beat-sync`, `audio-master` | 912x | CPU via compose or module VPC shim |
| `film-titles`, `subtitle` | 913x | Optional |

Cloud-only modules (`kling`, `cloud-keyframe`, `music-gen` Workflows, etc.) are **optional install profiles** documented in `.env.example`; absent modules simply do not appear in `GET /api/modules`.

## Object storage

**Default:** S3-compatible storage via **MinIO** (`docker compose up -d`). The studio uses the same `S3_*` env vars as production R2/S3; switching providers is a config change only.

| Provider | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
|----------|---------------|-------------|------------------------|
| MinIO (local) | `http://127.0.0.1:9000` | `us-east-1` | `true` |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | `auto` | `false` |
| AWS S3 | `https://s3.<region>.amazonaws.com` | e.g. `us-east-1` | `false` |

Presigning uses the same SigV4 query-string scheme as `vivijure/src/r2-presign.ts` (`src/platform/s3-presign.ts`), so CPU containers receive short-lived GET/PUT URLs exactly like the CF Worker path.

**Filesystem fallback:** if `S3_*` is unset, the studio falls back to `ARTIFACT_ROOT` (used by CI unit tests). Homelab operators should run MinIO.

Backends (`vivijure-backend`, `local-gpu`) never see the storage implementation; they read/write by key only.

## CPU media stack

Copy `vivijure/containers/compose.yaml` services (video-finish, image-prep, audio-beat-sync, audio-mix, audio-master). Today the CF Worker reaches them via Workers VPC; locally they are `http://127.0.0.1:8780-8784`.

Module workers that called VPC fetchers (`beat-sync`, finish modules) use `*_VPC_URL` env vars pointing at the same localhost ports.

## Auth

v1 supports `AUTH_MODE=token` (default) and `AUTH_MODE=demo` (`STUDIO_API_TOKEN` + D1-shaped `api_tokens` table (named tokens = full operator reach, no scope column -- local#238)). CF Access is a cloud-host concern; not ported.

**Named tokens are attribution, not scope (local#238).** `api_tokens` is `(name, token_hash,
created_at, revoked_at)` with **no capability column**. `verifyTokenRequest` admits a named token
with the same authority as `STUDIO_API_TOKEN` (renders, settings, every `/api` route). Blast radius
is bounded by **revocation** and visible via **attribution** (`sub: api-token:<name>`), not by
permission. Honest description until a scope column lands: an operator token with a name on it.
Mint with `scripts/mint-api-token.sh`; revoke by setting `revoked_at`.

## Port order (implementation sequence)

1. **Platform adapters** -- sqlite, storage, secrets, module HTTP transport
2. **Health + static UI** -- `GET /health`, serve `public/`
3. **Registry** -- port `src/modules/registry.ts`, wire HTTP modules
4. **CRUD routes** -- projects, cast, prefs, `GET /api/modules`
5. **Artifact routes** -- upload, `/api/artifact/*` with Range support
6. **Film orchestrator** -- port `film-orchestrator.ts`, job docs on ObjectStore
7. **Planner** -- port with BYOK providers (mock mode for CI)
8. **Render sweep** -- cron equivalent
9. **Conformance + vitest** -- upstream test subset against local stack

Track route-level progress in `docs/PARITY.md`.

## Syncing from upstream

During Option B, core logic is copied from `vivijure-cf/src/` and adapted at binding call sites (`env.DB` -> `platform.db`, etc.). Use `scripts/sync-from-vivijure.sh` before large ports to diff upstream changes.

When vivijure v2.0 lands shared core, this repo deletes duplicated orchestration and depends on the package instead.
