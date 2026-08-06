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
docker compose (default homelab)
  |-- studio (:8790)     SQLite + Hono API + public/ UI
  |-- minio (:9000)      renders/, bundles/, job docs
  |-- video-finish       ffmpeg assemble/mux (CPU film.finish path)
  |-- image-prep, audio-beat-sync, audio-mix, audio-master   CPU media VPC shims
  |-- module-plan-enhance, module-cast-image, module-image-generate
  |-- module-keyframe, module-local-gpu
  |-- module-audio-master, module-beat-sync, module-film-titles, module-subtitle
  |-- module-dialogue-gen, module-music-gen, module-notify-email
  `-- optional profiles: cloud, satellites (see install-profiles.md)
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
| GPU host (local door) | **Required to render** keyframes/motion; the stack boots without one but reports those hooks unavailable |

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
| 8781 | image-prep (default) |
| 8782 | audio-beat-sync (default) |
| 8783 | audio-mix (default) |
| 8784 | audio-master (default) |

Module sidecars listen on the Docker network only (e.g. `module-local-gpu:9102`). The studio
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
| `PLANNER_AI_MOCK` | `false` | Set `true` for offline/CI without Ollama model pull |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Homelab plan.enhance provider |
| `OLLAMA_PLAN_MODEL` | `qwen3:14b` | Default open-weight planner (~9.3GB Q4; 16GB headroom) |

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

**ORDER MATTERS: force-recreate FIRST, then sync.** `sync-minio-tunnel-secrets.ts` upserts
`platform_secrets` from the **studio container process env**, NOT from the `.env` file on disk.
Its `import "dotenv/config"` does not help: dotenv never overrides an already-set variable, and
the studio container was created with the OLD value. So running the sync before the recreate
writes the STALE value straight back into the DB, where it then wins over compose env forever.

```bash
# 1. recreate so the containers pick up the new .env into their process env
docker compose up -d --force-recreate studio module-local-gpu
# 2. THEN sync, so the DB captures the new value
npm run sync:secrets:compose
```

Module sidecars re-read `platform_secrets` per invoke (`loadModuleRuntimeEnv`), so no second
recreate is needed after the sync.

**local-gpu (homelab):** set `LOCAL_BACKEND_URL` to the reachable GPU backend URL and
`LOCAL_BACKEND_TOKEN` to the backend bearer token, then run the sync + recreate sequence above.

Update RunPod / remote GPU `S3_*` env to match. MinIO data volume keeps existing objects; only
the root user password changes.

### Homelab path: Ollama → unload → local-gpu (local#265)

Default first-win sequence on one card:

**plan → unload → keyframe** (then motion / optional local finish on the same card).

1. **Ollama** serves `plan.enhance` (`OLLAMA_PLAN_MODEL`, default **`qwen3:14b`**).
2. After enhance/chat completes, the planner **unloads** the model (`keep_alive: 0`).
3. Before any studio film/clip submit and again in the local-gpu (keyframe + motion) and
   local-finish sidecars, Ollama is best-effort unloaded so the door can claim VRAM.
4. **local-gpu** keyframe (`action: preview`) then motion on the same door; finish stays CPU
   assemble (+ optional local GPU finish / satellites).

**Why `qwen3:14b` (kept as default):** Ollama library Q4_K_M ~9.3GB, comfortable on a 16GB door
with KV headroom for storyboard JSON. Strongest published library fit for creative writing,
scripts, shot lists, and instruction-following auto-direction without eating the card.
Rejected as default: `mistral-small:24b` (~14GB Q4, almost no KV headroom on 16GB);
community creative fine-tunes (not Ollama-library stable for first-win installs). Catalog also
offers `deepseek-r1:14b` (~9GB, heavier reasoning) and `qwen3:8b` (~5.2GB, smaller cards).
Structured enhance/plan calls send `think: false` + cooler temperature so CoT/JSON stay clean;
chat opts into `think: true` with a creative-director system default.

Compose starts `ollama` + one-shot `ollama-pull` (retries + `ollama show` verify).
`npm run compose:up` waits for the pull when `PLANNER_AI_MOCK` is not true.
`module-plan-enhance` depends on pull success so the sidecar does not serve before the model exists.
On NVIDIA hosts sharing the door GPU, use the overlay:

```bash
docker compose -f compose.yaml -f compose.ollama-nvidia.yaml up -d
# or: COMPOSE_FILE=compose.yaml:compose.ollama-nvidia.yaml
```

Without the overlay Ollama runs on CPU (acceptable for CI / Mac). AI Gateway / Anthropic catalog
rows remain an opt-in overlay when gateway creds are set and you pick an `anthropic/*` model id.

### Switching 12GB ↔ 16GB GPU doors (homelab)

**Default door is 16GB** ([`vivijure-local-16gb`](https://github.com/skyphusion-labs/vivijure-local-16gb)).
The 12GB door ([`vivijure-local-12gb`](https://github.com/skyphusion-labs/vivijure-local-12gb), LTX)
is the alternate. Co-located panels often run both with door-pin scripts (see
[fleet#962](https://github.com/skyphusion-labs/fleet-chezmoi/issues/962) for IaC reconciliation).
Only one door may hold the GPU at a time (and Ollama must be unloaded before the door job starts).

**Engine asymmetry (local#235) -- not just a pin difference.** The two doors run different motion
engines and different duration contracts:

| Door | Typical host (fleet) | Image | Engine | `duration_grid` |
| --- | --- | --- | --- | --- |
| Flagship CF door | fatmike | `vivijure-local-12gb` | **ltx-video** | **absent** (flexible `seconds * fps`) |
| Local panel door | propagandhi | `vivijure-local-16gb` | **cogvideox** | fps 8, 49 max_frames on all tiers |

Same panel request, different clip lengths and motion characteristics depending on which door is
bound. `module-local-gpu` snaps shot length to the door-declared grid when present, and falls back
to flexible seconds when absent. The 49-frame grid closes the CogVideoX tile-noise class (fc#597);
that class does not apply to LTX. Do not assume "swap doors, same film." Confirm `/health`
`engine` + `duration_grid` after every pin.
**Model licence (local#278):** the local-gpu panel cost is not "free once the card is paid." There is
no cloud API bill on your hardware, but the **default 16GB CogVideoX** door is free for academic
research and may require commercial registration (and a monthly usage cap) for commercial use --
check that door's licence before production. The 12GB LTX door is a different engine and licence.
The manifest cost string is `Hardware; model licence may apply`.

After pinning the target door up, **all three steps are mandatory** (skipping recreate leaves a
stale `LOCAL_BACKEND_URL` in `platform_secrets` and in the studio process env; smokes will still
point at the previous door):

1. Update studio `.env`:
   - 16GB (default): `LOCAL_BACKEND_URL=http://vivijure-local-16gb:8000`
   - 12GB (alternate): `LOCAL_BACKEND_URL=http://vivijure-local-12gb:8000`
   - Set `LOCAL_BACKEND_TOKEN` to match the active door bearer token. A door swap ALWAYS
     regenerates the bearer (each door writes its own `/shared/token` in its own project-scoped
     runtime volume), so this is never a no-op.
2. `docker compose up -d --force-recreate studio module-local-gpu` (recreate BEFORE the sync)
3. `npm run sync:secrets:compose`
4. **Verify the DB, not the process env** (see the warning below):

   ```bash
   docker compose exec -T studio npx tsx -e "import{listPlatformSecrets}from./src/platform-secrets-db.js;import{openDatabase}from./src/platform/sqlite.js;const d=openDatabase(process.env.DATABASE_PATH);console.log((await listPlatformSecrets(d)).LOCAL_BACKEND_URL)"
   ```

> **A process-env probe CANNOT detect a stale door here, and that is the whole trap.**
> `docker compose exec studio printenv LOCAL_BACKEND_URL` and a direct curl to the new door will
> BOTH read correct while the sidecar still dials the old one, because the sidecar resolves its
> backend from `platform_secrets` (DB wins), not from its process env. The failure surfaces only
> at render time as `local-gpu keyframe submit failed: fetch failed` -- a connection error against
> the door you just stopped. Verify the DB value. Found live on propagandhi, cf#224.

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

**No local RIFE** (Conrad 2026-07-28). vivijure-local does not ship a finish-rife image or
`LOCAL_FINISH_RIFE_URL` path. Homelab default is CPU `video-finish` assemble. RIFE runs on the
RunPod backend worker for vivijure-cf/production (and only as explicit RunPod opt-in on the local
panel).

When registered, lipsync/upscale sidecars proxy to **RunPod** (`FINISH_BACKEND=runpod`) or **local
GPU HTTP** (`FINISH_BACKEND=local` + `LOCAL_FINISH_LIPSYNC_URL` / `LOCAL_FINISH_UPSCALE_URL`). A
registered module with missing creds or backend URL **fails the shot** (`ok: false`); finish
handlers do not passthrough fake output.

See [FINISH_BACKEND.md](FINISH_BACKEND.md) for env vars, propagandhi teardown notes, and smoke matrix.

Production R2 deploys keep HTTPS-only guards (`S3_ALLOW_HTTP_FETCH=false`).

### Module sidecars

Compose wires all CPU module URLs in-network by default. **No RunPod modules** are registered in
the default stack. Override in `.env` to point at host-native sidecars. RunPod keyframe, cloud i2v,
own-gpu, speech-upscale, and finish GPU URLs stay empty until you enable `COMPOSE_PROFILES=cloud`
or `satellites`. `narration-gen` needs no RunPod: its default engine is Deepgram Aura-1 on Cloudflare
AI (the RunPod MiniMax HD tier activates only when `RUNPOD_API_KEY` is set); its sidecar ships in the
default stack (local#209).

| Variable | Compose default |
|----------|-----------------|
| `MODULE_KEYFRAME_URL` | *(empty; `cloud` profile -- RunPod keyframe)* |
| `MODULE_LOCAL_GPU_URL` | *(empty; `localgpu` profile -- set by `install:studio` from `LOCAL_BACKEND_URL`)* |
| `MODULE_BEAT_SYNC_URL` | `http://module-beat-sync:9120` |
| `MODULE_AUDIO_MASTER_URL` | `http://module-audio-master:9121` |
| `MODULE_FILM_TITLES_URL` | `http://module-film-titles:9130` |
| `MODULE_SUBTITLE_URL` | `http://module-subtitle:9131` |
| `MODULE_PLANENHANCE_URL` | `http://module-plan-enhance:9140` |
| `MODULE_CAST_IMAGE_URL` | `http://module-cast-image:9141` |
| `MODULE_DIALOGUE_URL` | `http://module-dialogue-gen:9142` |
| `MODULE_IMAGE_GENERATE_URL` | `http://module-image-generate:9145` |
| `MODULE_MUSIC_GEN_URL` | `http://module-music-gen:9158` |
| `MODULE_NARRATION_GEN_URL` | `http://module-narration-gen:9159` |
| `MODULE_NOTIFY_EMAIL_URL` | `http://module-notify-email:9144` |
| `MODULE_SPEECH_UPSCALE_URL` | *(empty; `cloud` profile -- RunPod `vivijure-audio-upscale`)* |
| `MODULE_OWN_GPU_URL` | *(empty; `cloud` profile)* |
| `MODULE_*` cloud i2v | *(empty; `cloud` profile)* |
| `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL` | *(empty; `satellites` profile)* |

### CPU VPC shims (studio -> containers)

| Variable | Port |
|----------|------|
| `VIDEO_FINISH_URL` | 8780 |
| `IMAGE_PREP_URL` | 8781 |
| `AUDIO_BEAT_SYNC_URL` | 8782 |
| `AUDIO_MIX_URL` | 8783 |
| `AUDIO_MASTER_URL` | 8784 |

### Live planner (default: Ollama)

Compose defaults `PLANNER_AI_MOCK=false` and `OLLAMA_BASE_URL=http://ollama:11434`. Wait for
`ollama-pull` (or `docker compose run --rm ollama-pull`) before the first real enhance.

**Opt-in overlays** (not required for the homelab path):

1. **AI Gateway:** `CLOUDFLARE_ACCOUNT_ID`, `GATEWAY_ID`, `CF_AIG_TOKEN` + pick an `anthropic/*` model
2. **Direct BYOK:** `ANTHROPIC_API_KEY` (where the module stack supports it)

Offline/CI without pulling weights: `PLANNER_AI_MOCK=true`.

---

## GPU backends: no door vs real door

**There is no mock GPU tier** (local#229) and **no doorless GPU service** (local#280). The GPU door
module lives in the `localgpu` compose profile. With no door configured:

- `module-local-gpu` **is not in the stack**. Not started, not unhealthy, not hidden -- absent.
  `docker compose config --services` does not list it, and `studio` does not `depends_on` it, so a
  box with no GPU boots normally;
- no `MODULE_LOCAL_GPU_URL` is bound, so the studio's module registry has no keyframe/motion module
  to offer and cannot advertise one;
- `GET /api/modules` reports `keyframe` and `motion.backend` in `host.hooks_unavailable`, naming the
  knob, so the panel greys the controls out **before** a render is started. That is the host
  describing its own composition, not a service describing its own absence.

Two earlier shapes of this are both gone. The original wrote a 1x1 PNG per keyframe and a black clip
per shot to MinIO and reported the render COMPLETED, producing films assembled from fabricated frames.
The first fix kept the container running to answer `configured: false` about itself -- rejected: "We
shouldn't have to build a shim for a module that isn't even there." There is **no RunPod keyframe
sidecar** in the default stack either.

**Real door (16GB first):** run [`vivijure-local-16gb`](https://github.com/skyphusion-labs/vivijure-local-16gb)
(or the 12GB alternate) on your host, set `LOCAL_BACKEND_URL` (e.g. `http://vivijure-local-16gb:8000`
on a shared Docker network, or `http://host.docker.internal:8000` when the door publishes on the
host), then run `npm run install:studio`. That derives the rest of the lane into `.env`
(`COMPOSE_PROFILES` gains `localgpu`, `MODULE_LOCAL_GPU_URL` is set), so the door address stays the
only thing you edit. Then recreate `module-local-gpu` and sync secrets (see door-switch section
above).

If you enable the profile by hand but leave `LOCAL_BACKEND_URL` empty, `localgpu-door-gate` fails the
lane at startup rather than bringing a sidecar up pointing at nothing.

**The no-RunPod render path (default):** Ollama for `plan.enhance` (unload after), local-gpu door for
keyframes + motion, CPU `video-finish` to assemble. Optional CF AI for dialogue/music/narration
overlays. RunPod modules only appear after `COMPOSE_PROFILES=cloud` (or satellites) and the matching
`MODULE_*_URL` + credentials; an unconfigured RunPod tier is never a broken button.

**RunPod escape hatch (optional):** set `FINISH_BACKEND=runpod` and `*_RUNPOD_ENDPOINT_ID`, or point
`MODULE_*_URL` at deployed `vivijure-backend` workers. Not the homelab default; see
[FINISH_BACKEND.md](FINISH_BACKEND.md).

Finish GPU satellites are optional: default compose skips them (`satellites` profile + env URLs).
The demo path assembles raw clips after motion; homelab production wires finish sidecars only when
opted in (see [install-profiles.md](install-profiles.md)).

### Cast LoRA train (homelab vs CF prod)

Wan cast LoRA training (`POST /api/cast/:id/train-lora`) is **CF prod only**. vivijure-cf binds
`RUNPOD_WAN_TRAIN_ENDPOINT_ID` to the dedicated Wan train endpoint; when wired, `/train-lora`
defaults to Wan (`model_family:"wan"`). Homelab **does not** set `RUNPOD_WAN_TRAIN_ENDPOINT_ID`
(Conrad ruling 2026-07-23).

| Host | Wan train | Local `/train-lora` default |
|------|-----------|-----------------------------|
| vivijure-cf (prod) | `RUNPOD_WAN_TRAIN_ENDPOINT_ID` → dedicated EP | Wan when endpoint wired |
| vivijure-local (homelab) | **Not wired** | SDXL on render endpoint (`RUNPOD_ENDPOINT_ID`) |

Escape hatches on homelab: pass `model_family:"sdxl"` explicitly, or train cast LoRAs on CF prod.

After removing a stale Wan train key from `.env`, run `npm run sync:secrets:compose` so
`platform_secrets` purges `RUNPOD_WAN_TRAIN_ENDPOINT_ID`, then force-recreate `studio`.

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
// Wrong -- 400 (schema rejects unknown key "local-gpu" inside motion_config)
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
sites. `public/` (studio UI), `migrations/` (SQLite schema) and `src/modules/types.ts` (the
`vivijure-module/2` contract) started as verbatim copies of the upstream files.

**There is no longer a CI check asserting they stay byte-identical.** `upstream-parity` diffed
shared `public/` against `skyphusion-labs/vivijure-cf` `main` on every PR; it was retired in
local#263. The two hosts' backends now legitimately emit different wire shapes, so byte-identity
of the shared frontend stopped being a true statement about a working system and started
reporting the honest change as the defect.

What is left is a manual porting aid, which OVERWRITES local copies with upstream's:

```bash
./scripts/sync-from-vivijure.sh   # requires sibling ../vivijure-cf clone
```

**What still holds is PRODUCT parity, and it is a review obligation now:** every studio feature
ships to both panels in the same release wave (same-time releases, no community edition, no pay
gates). Nothing in CI detects a shared-UI change landing in only one panel.
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
behind a Hetzner L4 edge load balancer. This is **not** the homelab
`COMPOSE_PROFILES=edge` path from [EDGE.md](EDGE.md). Fleet IaC owns the overlay files.

Addresses below are RFC 5737 documentation placeholders: `192.0.2.7` stands for this
host's own VLAN address, `198.51.100.0/24` for the edge load balancer's subnet.
Substitute your own; nothing here is a literal to copy.

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

3. Set **`EDGE_BIND_IP`** in `.env` to this host's own VLAN address (with the placeholder
   above, `EDGE_BIND_IP=192.0.2.7`). Compose publishes Caddy on that VLAN address only.
   Do **not** use `CADDY_BIND_IP` (wrong key; Caddy falls back to `0.0.0.0`).

4. Roll the **full** stack with the reverse-proxy profile:

   ```bash
   COMPOSE_PROFILES=reverse-proxy docker compose pull
   COMPOSE_PROFILES=reverse-proxy docker compose up -d --pull always
   ss -ltnp | grep ':443'   # must show $EDGE_BIND_IP, not 0.0.0.0
   ```

5. Reconcile host firewall after deploy:

   ```bash
   sudo /opt/fleet-chezmoi/system/ufw/apply-ufw.sh propagandhi
   ```

   Allows edge LB traffic (the load balancer subnet, `198.51.100.0/24` here) to port
   443 on `$EDGE_BIND_IP`. VLAN bind remains the load-bearing control; ufw is
   belt-and-suspenders.

Canonical operator checklist:
[fleet-chezmoi `vivijure-local-propagandhi-release.md`](https://github.com/skyphusion-labs/fleet-chezmoi/blob/main/docs/runbooks/vivijure-local-propagandhi-release.md).
Stack README:
[`system/stacks/propagandhi/vivijure-local/`](https://github.com/skyphusion-labs/fleet-chezmoi/tree/main/system/stacks/propagandhi/vivijure-local).
