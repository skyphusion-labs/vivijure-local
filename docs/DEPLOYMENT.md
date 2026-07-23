# Deploying vivijure-local (homelab)

Operator reference for the **homelab / hobbyist** Node/Docker host of Vivijure Studio. Full
**capability parity** with [`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf) on the
same module contract; default GPU path is **local renders** (local GPU door + local finish
sidecars). For production workloads, deploy [`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf)
instead.

Canonical API contract: [vivijure-cf/docs/CONTRACT.md](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/CONTRACT.md).

> **Single-operator homelab host.** Verified end to end on the homelab stack. Run it on a network
> you control (see [SECURITY.md](SECURITY.md)); it is not a multi-tenant deployment. RunPod is an
> optional escape hatch, not the homelab default ([local#180](https://github.com/skyphusion-labs/vivijure-local/issues/180),
> [FINISH_BACKEND.md](FINISH_BACKEND.md)).

---

## What you are deploying

`vivijure-local` has three layers:

1. **Studio** (this repo's Node server) -- projects, storyboards, cast, planner, render
   orchestration, module registry. Same JSON API shape as upstream `vivijure`.
2. **Object storage** -- MinIO by default (`S3_*` env vars). Same presign pattern as Cloudflare R2.
3. **Satellites** -- CPU media containers plus HTTP module sidecars. In Cloudflare these are Worker
   bindings and VPC links; here they are Docker services and `MODULE_*_URL` fetchers.

```
docker compose (default homelab minimal)
  |-- studio (:8790)     SQLite + Hono API + public/ UI
  |-- minio (:9000)      renders/, bundles/, job docs
  |-- video-finish       ffmpeg assemble/mux (CPU film.finish path)
  |-- audio-master       music-upscale + loudness (CPU)
  |-- module-plan-enhance, module-cast-image, module-image-generate
  |-- module-keyframe, module-local-gpu, module-audio-master, module-subtitle, module-notify-email
  `-- optional profiles: media, cloud, satellites (see install-profiles.md)
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
| 8780 | video-finish (default) |
| 8784 | audio-master (default) |
| 8781 | image-prep (`COMPOSE_PROFILES=media`) |
| 8782 | audio-beat-sync (`COMPOSE_PROFILES=media`) |
| 8783 | audio-mix (`COMPOSE_PROFILES=media`) |

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
| `S3_ALLOW_HTTP_FETCH` | `true` | Set `false` when presign uses HTTPS (Caddy edge) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `minioadmin` | MinIO credentials; rotate before public expose (see below) |
| `S3_BUCKET` | `vivijure` | Render + bundle bucket (same name as prod R2 `vivijure`) |

`minio-init` seeds prod-parity top-level prefixes on first boot: `renders/`, `bundles/`, `audio/`, `uploads/` (plus `README.txt` key map). Clip jobs for own-gpu/local-gpu stage keyframes at `renders/<project>/keyframes/<shot_id>.png`.
| `S3_REGION` | `us-east-1` | SigV4 region |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO |

Swap to Cloudflare R2 or AWS S3 by changing `S3_*` only (see `.env.example`).

CPU containers receive `ALLOW_HTTP_FETCH` and `ALLOWED_FETCH_HOSTS` from compose so they can fetch
presigned MinIO URLs. When MinIO is public for RunPod or remote GPU backends, use the Caddy edge
(`COMPOSE_PROFILES=edge`), set `S3_PRESIGN_ENDPOINT` to the public MinIO HTTPS URL, and extend
`S3_FETCH_ALLOW_HOSTS` to include that hostname. Full guide: [EDGE.md](EDGE.md).

**Rotate MinIO root credentials** before public expose (default `minioadmin` is fine for
localhost-only dev):

```bash
npm run rotate:minio-creds     # writes S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY to .env
npm run sync:secrets:compose   # upsert .env into platform_secrets (studio Docker volume DB)
docker compose up -d --force-recreate minio minio-init studio
```

When studio runs in compose, secrets live in the `studio-data` volume (`/app/vivijure-local/data/studio.db`).
At runtime **`platform_secrets` in SQLite wins over compose env** for keys the sync script upserts
(`LOCAL_BACKEND_URL`, RunPod endpoint IDs, `S3_*`, etc.). Editing `.env` alone does not change what
a running studio reads; `npm run sync:secrets:compose` upserts `.env` into the DB, but the studio
and `module-local-gpu` containers still hold **process env from their last create** until
force-recreate.

Use `sync:secrets:compose` after every `.env` change, then **always** force-recreate the consumers:

```bash
npm run sync:secrets:compose
docker compose up -d --force-recreate studio module-local-gpu
```

**local-gpu (homelab):** set `LOCAL_BACKEND_URL` to the reachable GPU backend URL and
`LOCAL_BACKEND_TOKEN` to the backend bearer token, then run the sync + recreate sequence above.

Update RunPod / remote GPU `S3_*` env to match. MinIO data volume keeps existing objects; only
the root user password changes.

### Switching 12GB ↔ 16GB GPU doors (homelab)

Co-located panels often run [`vivijure-local-12gb`](https://github.com/skyphusion-labs/vivijure-local-12gb)
(LTX) and [`vivijure-local-16gb`](https://github.com/skyphusion-labs/vivijure-local-16gb) (CogVideoX)
on the same host with door-pin scripts (see
[fleet#962](https://github.com/skyphusion-labs/fleet-chezmoi/issues/962) for IaC reconciliation).
Only one door may hold the GPU at a time.

After pinning the target door up, **all three steps are mandatory** (skipping recreate leaves a
stale `LOCAL_BACKEND_URL` in `platform_secrets` and in the studio process env; smokes will still
point at the previous door):

1. Update studio `.env`:
   - 12GB: `LOCAL_BACKEND_URL=http://vivijure-local-12gb:8000`
   - 16GB: `LOCAL_BACKEND_URL=http://vivijure-local-16gb:8000`
   - Set `LOCAL_BACKEND_TOKEN` to match the active door's bearer token.
2. `npm run sync:secrets:compose`
3. `docker compose up -d --force-recreate studio module-local-gpu`

Verify: `docker compose logs module-local-gpu | tail` should show the new backend URL (not the
previous door).

**Local keyframes (#153):** `local-gpu` is dual-hook (keyframe + motion). Picking
`motion_backend: local-gpu` couples keyframes onto the same door's `action: preview` (SDXL on the
homelab card); no RunPod `vivijure-backend` for the keyframe phase. Redeploy/recreate
`module-local-gpu` (and the 12gb/16gb door image) after upgrading so the manifest advertises the
`keyframe` hook and the door accepts `preview`. After [local#180](https://github.com/skyphusion-labs/vivijure-local/issues/180)
cutover, finish sidecars default to local URLs; keep `RUNPOD_WORKERS_MAX=3` in `.env` only when
`FINISH_BACKEND=runpod` (do not use 4).

### Finish GPU backend (homelab vs RunPod)

Finish GPU sidecars (`module-finish-{lipsync,upscale}`) are **opt-in**: compose gates them behind
`profiles: [satellites]` and leaves `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL` empty by default so
discovery skips the per-clip finish chain. Minimal homelab assembles via CPU `video-finish` only.

**RIFE is not supported on vivijure-local.** There is no `module-finish-rife` sidecar, no
`LOCAL_FINISH_RIFE_URL`, and no local finish-rife-serve overlay. RIFE runs on the RunPod backend
worker for vivijure-cf/production only (Conrad ruling 2026-07-22).

When registered, lipsync/upscale sidecars proxy to **RunPod** (`FINISH_BACKEND=runpod`) or **local
GPU HTTP** (`FINISH_BACKEND=local` + `LOCAL_FINISH_LIPSYNC_URL` / `LOCAL_FINISH_UPSCALE_URL`). A
registered module with missing creds or backend URL **fails the shot** (`ok: false`); finish
handlers do not passthrough fake output.

See [FINISH_BACKEND.md](FINISH_BACKEND.md) for env vars, propagandhi teardown notes, and smoke matrix.

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

**RunPod escape hatch (optional):** set `FINISH_BACKEND=runpod` and `*_RUNPOD_ENDPOINT_ID`, or point
`MODULE_*_URL` at deployed `vivijure-backend` workers. Not the homelab default; see
[FINISH_BACKEND.md](FINISH_BACKEND.md).

Finish GPU satellites are optional: default compose skips them (`satellites` profile + env URLs).
The demo path assembles raw clips after motion; homelab production wires finish sidecars only when
opted in (see [install-profiles.md](install-profiles.md)).

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

### Film submit: `motion_config` shape

`POST /api/projects/:id/render/film` (Studio MCP `submit_film`, smoke scripts, deploy automation)
expects **flat** `motion_config` and `keyframe_config` maps. The motion module is selected by the
top-level `motion_backend` field, not by nesting under the backend id.

`finish_config`, `speech_config`, `film_finish_config`, and `master_config` **do** nest by module id;
`motion_config` and `keyframe_config` do not. Mixing the two shapes is a common 400.

```json
// Wrong — 400 (schema rejects unknown key "local-gpu" inside motion_config)
{
  "motion_backend": "local-gpu",
  "motion_config": { "local-gpu": { "quality": "draft" } }
}

// Correct
{
  "motion_backend": "local-gpu",
  "motion_config": { "quality": "draft" }
}
```

Verified on propagandhi 12GB door film smoke (agent `212d8ff5`): nested config failed submit;
flat config succeeded (`film-0542ed5e`). Same rule applies to `npm run smoke:exit`,
`npm run smoke:exhaustive`, and any MCP or API caller.

---

## Syncing from upstream

During Option B, orchestration code is copied from `vivijure/src/` and adapted at platform call
sites. Three surfaces are **verbatim copies** and must stay aligned with `vivijure` `main`:

- `public/` (studio UI)
- `migrations/` (SQLite schema)
- `src/modules/types.ts` (`vivijure-module/2` contract)

CI runs `upstream-parity` on every PR: it checks out `skyphusion-labs/vivijure-cf` `main` and diffs
`public/` (the studio UI). For the full verbatim set including migrations and types:

```bash
VIVIJURE_SRC=../vivijure-cf npm run upstream:parity       # public/ only (CI gate)
VIVIJURE_SRC=../vivijure-cf npm run upstream:parity:verbatim # + migrations, types.ts
./scripts/sync-from-vivijure.sh   # requires sibling ../vivijure-cf clone
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
| local-gpu hits wrong door after 12GB↔16GB swap | Stale `LOCAL_BACKEND_URL` in `platform_secrets` or container env | Update `.env`, `sync:secrets:compose`, `--force-recreate studio module-local-gpu` (see above) |
| keyframe RunPod quota / workersMax restore failed | `RUNPOD_WORKERS_MAX=4` on local panel EP | Set `RUNPOD_WORKERS_MAX=3` in `.env`; recreate RunPod module sidecars |
| Film submit 400 on `motion_config` | Nested config keyed by backend id (e.g. `{ "local-gpu": { ... } }`) | Flat map + top-level `motion_backend` (see **Film submit: motion_config shape** above) |

---

## Production: use vivijure-cf

Recommend [`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf) for production studio
workloads (Workers, R2, AI Gateway, RunPod render testbed). `vivijure-local` is the homelab /
hobbyist host with full contract parity, not the production deploy path:

- [vivijure-cf quickstart](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/quickstart.md)
- [vivijure-cf DEPLOYMENT](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/DEPLOYMENT.md)

---

## Production: propagandhi (fleet overlay)

The live public studio at `https://vivijure-local.skyphusion.org` runs on **propagandhi**
(`10.1.1.7`) behind a Hetzner L4 edge load balancer. This is **not** the homelab
`COMPOSE_PROFILES=edge` path from [EDGE.md](EDGE.md). Fleet IaC owns the overlay files.

**Every release roll must:**

1. Check out the pinned vivijure-local tag in the compose root (typically
   `/home/strummer/dev/vivijure-local` on propagandhi).
2. Copy fleet files **before** `docker compose up` (git checkout does not restore them):

   ```bash
   FLEET=/opt/fleet-chezmoi/system/stacks/propagandhi/vivijure-local
   cp "$FLEET/docker-compose.override.yml" .
   mkdir -p caddy && cp "$FLEET/caddy/Caddyfile.propagandhi ./caddy/
   ```

   The override mounts the fleet Caddyfile (PROXY protocol wrapper for the edge LB). Without
   it, Caddy listens but the public URL breaks.

3. Set **`EDGE_BIND_IP=10.1.1.7`** in `.env`. Compose publishes Caddy on this VLAN address
   only. Do **not** use `CADDY_BIND_IP` (wrong key; Caddy falls back to `0.0.0.0`).

4. Roll the **full** stack with the reverse-proxy profile:

   ```bash
   COMPOSE_PROFILES=reverse-proxy docker compose pull
   COMPOSE_PROFILES=reverse-proxy docker compose up -d --pull always
   ss -ltnp | grep ':443'   # must show 10.1.1.7, not 0.0.0.0
   ```

5. Reconcile host firewall after deploy:

   ```bash
   sudo /opt/fleet-chezmoi/system/ufw/apply-ufw.sh propagandhi
   ```

   Allows edge LB traffic (`10.1.0.0/16`) to `10.1.1.7:443`. VLAN bind remains the
   load-bearing control; ufw is belt-and-suspenders.

Canonical operator checklist:
[fleet-chezmoi `vivijure-local-propagandhi-release.md`](https://github.com/skyphusion-labs/fleet-chezmoi/blob/main/docs/runbooks/vivijure-local-propagandhi-release.md).
Stack README:
[`system/stacks/propagandhi/vivijure-local/`](https://github.com/skyphusion-labs/fleet-chezmoi/tree/main/system/stacks/propagandhi/vivijure-local).
