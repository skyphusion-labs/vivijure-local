# Deploying vivijure-local (homelab)

This is the operator reference for the Node/Docker host of Vivijure Studio. It covers
prerequisites, environment variables, compose services, GPU backends, verification gates, and
how this path differs from upstream Cloudflare deploy.

Canonical API contract: [vivijure-cf/docs/CONTRACT.md](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/CONTRACT.md).

> **Single-operator homelab host, still evolving.** Verified end to end on the homelab stack.
> Layout, env vars, and internal adapters may still change as we extract `vivijure-core`. Run it on
> a network you control (single-operator trust model, see [SECURITY.md](SECURITY.md)); it is not a
> multi-tenant deployment.

---

## What you are deploying

`vivijure-local` has three layers:

1. **Studio** (this repo's Node server) -- projects, storyboards, cast, planner, render
   orchestration, module registry. Same JSON API shape as upstream `vivijure`.
2. **Object storage** -- MinIO by default (`S3_*` env vars). Same presign pattern as Cloudflare R2.
3. **Satellites** -- CPU media containers plus HTTP module sidecars. In Cloudflare these are Worker
   bindings and VPC links; here they are Docker services and `MODULE_*_URL` fetchers.

```
docker compose
  |-- studio (:8790)     SQLite + Hono API + public/ UI
  |-- minio (:9000)      renders/, bundles/, job docs
  |-- video-finish ...   ffmpeg assembly, titles, subtitles (VPC from modules)
  |-- module-keyframe    GPU mock (or replace with real keyframe module URL)
  |-- module-local-gpu   GPU mock (or point at vivijure-local-12gb / RunPod)
  `-- module-beat-sync, module-audio-master, module-film-titles, module-subtitle
```

Technical adapter detail: [ARCHITECTURE.md](ARCHITECTURE.md). Route checklist: [PARITY.md](PARITY.md).

---

## Security requirement (read first): single-operator, token-gated

`vivijure-local` inherits the same **single-operator** model as upstream Vivijure. It performs
**no per-user authorization**. Every `:id` route trusts the caller. Deploy only where exactly one
operator (you) can reach the API.

v1 supports **`AUTH_MODE=token` only**:

- Set `STUDIO_API_TOKEN` in `.env` (compose passes it to the studio container).
- Every `/api/*` request must send `Authorization: Bearer <token>`.
- Missing or wrong token -> denied. No anonymous fallback.

Cloudflare Access (`AUTH_MODE=access`) is a cloud-host concern and is **not** ported here.

Full threat model and rotation notes: [SECURITY.md](SECURITY.md).

**Do not** expose an unauthenticated studio to the internet or a shared LAN without a reverse proxy
you control and a strong token.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker + Compose v2 | Runs the full demo stack |
| Node.js >= 22.5 | Host scripts, `npm test`, optional `npm run dev` |
| ~4 GB disk | Images + MinIO volume + render artifacts |
| Optional: GPU host | For real motion, not required for mock demo path |

---

## One-command deploy (recommended)

```bash
npm run install:studio
npm run compose:up
curl -fsS http://127.0.0.1:8790/health
```

`install:studio` mints `STUDIO_API_TOKEN`, writes `.studio-token`, and seeds `platform_secrets`.
First studio boot also copies any missing compose env into the DB. Re-run install only when `.env`
still has the `change-me-local-dev-only` placeholder.

### Service ports (host)

| Port | Service |
|------|---------|
| 8790 | Studio API + UI |
| 9000 / 9001 | MinIO API / console |
| 8780 | video-finish |
| 8781 | image-prep |
| 8782 | audio-beat-sync |
| 8783 | audio-mix |
| 8784 | audio-master |

Module sidecars listen on the Docker network only (e.g. `module-keyframe:9101`). The studio
container reaches them by hostname; use `npm run conformance:compose` to gate them from inside
the studio container.

---

## Environment variables

### Studio core

| Variable | Default (compose) | Purpose |
|----------|-------------------|---------|
| `STUDIO_API_TOKEN` | `change-me-local-dev-only` | Operator login; **change this** |
| `AUTH_MODE` | `token` | Only supported mode in v1 |
| `PORT` | `8790` | HTTP listen port |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8790` | Presign + artifact URLs for host clients |
| `DATABASE_PATH` | `/app/data/studio.db` | SQLite file (persisted volume) |
| `PLANNER_AI_MOCK` | `true` | Offline planner without API keys |

### Object storage (MinIO)

| Variable | Compose value | Purpose |
|----------|---------------|---------|
| `S3_ENDPOINT` | `http://minio:9000` | SDK endpoint (in-network) |
| `S3_PRESIGN_ENDPOINT` | `http://minio:9000` (override in `.env`) | Host embedded in presigned URLs |
| `S3_FETCH_ALLOW_HOSTS` | `minio` | CPU container SSRF allowlist for presigned fetches |
| `S3_ALLOW_HTTP_FETCH` | `true` | Set `false` when presign uses HTTPS (cloudflared) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `minioadmin` | MinIO credentials; rotate before tunnel expose (see below) |
| `S3_BUCKET` | `vivijure` | Render + bundle bucket (same name as prod R2 `vivijure`) |

`minio-init` seeds prod-parity top-level prefixes on first boot: `renders/`, `bundles/`, `audio/`, `uploads/` (plus `README.txt` key map). Clip jobs for own-gpu/local-gpu stage keyframes at `renders/<project>/keyframes/<shot_id>.png`.
| `S3_REGION` | `us-east-1` | SigV4 region |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO |

Swap to Cloudflare R2 or AWS S3 by changing `S3_*` only (see `.env.example`).

CPU containers receive `ALLOW_HTTP_FETCH` and `ALLOWED_FETCH_HOSTS` from compose so they can fetch
presigned MinIO URLs. When MinIO is exposed via **cloudflared** for RunPod or remote GPU backends,
set `S3_PRESIGN_ENDPOINT` to the tunnel HTTPS URL and extend `S3_FETCH_ALLOW_HOSTS` to include that
hostname. Full guide: [MINIO-TUNNEL.md](MINIO-TUNNEL.md).

**Rotate MinIO root credentials** before exposing the tunnel (default `minioadmin` is fine for
localhost-only dev):

```bash
npm run rotate:minio-creds          # writes S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY to .env
npm run sync:tunnel-secrets:compose # upsert .env into platform_secrets (studio Docker volume DB)
docker compose up -d --force-recreate minio minio-init studio
```

When studio runs in compose, secrets live in the `studio-data` volume (`/app/vivijure-local/data/studio.db`).
Use `sync:secrets:compose` (alias: `sync:tunnel-secrets:compose`) so the running studio and module
sidecars pick up `.env` changes (S3 tunnel, `LOCAL_BACKEND_*`, RunPod endpoint IDs, demo-off flags).

**local-gpu tunnel (homelab):** set `LOCAL_BACKEND_URL` to the TryCloudflare (or other) door URL and
`LOCAL_BACKEND_TOKEN` to the backend bearer token, then:

```bash
npm run sync:secrets:compose
COMPOSE_PROFILES=tunnel docker compose up -d --force-recreate studio module-local-gpu
```

Update RunPod / remote GPU `S3_*` env to match. MinIO data volume keeps existing objects; only
the root user password changes.

Production R2 deploys keep HTTPS-only guards (`S3_ALLOW_HTTP_FETCH=false`).

### Module sidecars

Compose sets `MODULE_KEYFRAME_URL`, `MODULE_LOCAL_GPU_URL`, and CPU module URLs automatically.
Override in `.env` to point at host-native sidecars or remote RunPod modules.

| Variable | Compose default |
|----------|-----------------|
| `MODULE_KEYFRAME_URL` | `http://module-keyframe:9101` |
| `MODULE_LOCAL_GPU_URL` | `http://module-local-gpu:9102` |
| `MODULE_BEAT_SYNC_URL` | `http://module-beat-sync:9120` |
| `MODULE_AUDIO_MASTER_URL` | `http://module-audio-master:9121` |
| `MODULE_FILM_TITLES_URL` | `http://module-film-titles:9130` |
| `MODULE_SUBTITLE_URL` | `http://module-subtitle:9131` |

### CPU VPC shims (studio -> containers)

| Variable | Port |
|----------|------|
| `VIDEO_FINISH_URL` | 8780 |
| `IMAGE_PREP_URL` | 8781 |
| `AUDIO_BEAT_SYNC_URL` | 8782 |
| `AUDIO_MIX_URL` | 8783 |
| `AUDIO_MASTER_URL` | 8784 |

### Live planner (optional)

Set `PLANNER_AI_MOCK=false` and provide **one** of:

1. **AI Gateway (preferred):** `CLOUDFLARE_ACCOUNT_ID`, `GATEWAY_ID`, `CF_AIG_TOKEN`
2. **Direct BYOK:** `ANTHROPIC_API_KEY`

Same variables as upstream `vivijure`.

---

## GPU backends: mock vs real

**Default (demo path):** compose runs `scripts/gpu-mock-module-server.ts` for `keyframe` and
`local-gpu`. Mocks write minimal PNG/MP4 artifacts to MinIO so the full orchestrator path runs
without a GPU.

**Real own-GPU:** run [`vivijure-local-12gb`](https://github.com/skyphusion-labs/vivijure-local-12gb)
or [`vivijure-local-16gb`](https://github.com/skyphusion-labs/vivijure-local-16gb) on your host.
Set `MODULE_LOCAL_GPU_URL` to the sidecar URL the backend exposes (from the studio container use
`http://host.docker.internal:<port>` on Docker Desktop).

**Cloud GPU:** point module URLs at deployed `vivijure-backend` module workers or RunPod endpoints
using the same `MODULE_*_URL` mechanism.

Finish GPU satellites (`finish-rife`, `finish-lipsync`) are optional; the demo compose omits their
URLs so the pipeline skips straight to assemble after motion.

---

## Host-native dev (no studio container)

For faster iteration on studio code:

```bash
docker compose up -d minio minio-init video-finish image-prep audio-beat-sync audio-mix audio-master
npm install
cp .env.example .env    # S3_ENDPOINT=http://127.0.0.1:9000, CPU URLs on localhost ports
npm run module-fleet    # optional: manifest sidecars on :9101+
npm run dev
```

See [quickstart.md](quickstart.md) and `scripts/dev-module-fleet.sh`.

---

## Verification gates (M8 parity)

Run after deploy or code changes:

```bash
npm run typecheck
npm test
npm run conformance              # unit suite; live skipped unless MODULE_URL is set
npm run conformance:compose      # live gate against compose sidecars (stack must be up)
npm run smoke:exit               # bundle -> render -> poll -> artifact
```

CI runs the **`ci`** check (`typecheck`, `npm test`, `npm run conformance`) on every push. Live compose gates are
operator-run today.

---

## Syncing from upstream

During Option B, orchestration code is copied from `vivijure/src/` and adapted at platform call
sites. Three surfaces are **verbatim copies** and must stay aligned with `vivijure` `main`:

- `public/` (studio UI)
- `migrations/` (SQLite schema)
- `src/modules/types.ts` (`vivijure-module/2` contract)

CI runs `upstream-parity` on every PR: it checks out `skyphusion-labs/vivijure` `main` and diffs
`public/` (the studio UI). For the full verbatim set including migrations and types:

```bash
VIVIJURE_SRC=../vivijure npm run upstream:parity          # public/ only (CI gate)
VIVIJURE_SRC=../vivijure npm run upstream:parity:verbatim # + migrations, types.ts
./scripts/sync-from-vivijure.sh   # requires sibling ../vivijure clone
```

When vivijure v2.0 lands `vivijure-core`, this repo will depend on the package instead of
manual sync for orchestration; `public/` parity remains until the UI is packaged separately.
See [ROADMAP.md](ROADMAP.md).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `GET /api/modules` returns `[]` | Sidecars not reachable; empty discovery race | `docker compose ps`; restart studio after modules healthy |
| Render 503 "no keyframe module" | `MODULE_*_URL` wrong or sidecar down | Check env inside studio: `docker compose exec studio env \| grep MODULE` |
| video-finish 400 "scheme not allowed" | Presign host not on CPU allowlist | Ensure `S3_PRESIGN_ENDPOINT=http://minio:9000` and CPU `ALLOWED_FETCH_HOSTS=minio` |
| Planner always mock | `PLANNER_AI_MOCK=true` | Set `false` and add gateway/BYOK keys |
| Smoke timeout | Slow first render or stuck job | `docker compose logs -f studio`; re-run after healthy |

---

## Prefer Cloudflare Workers?

The Cloudflare-hosted studio, with the full module catalog and deploy tooling, is
[`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf):

- [docs/quickstart.md](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/quickstart.md)
- [docs/DEPLOYMENT.md](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/DEPLOYMENT.md)

`vivijure-local` proves the same contract on your box; it does not replace that deploy today.
