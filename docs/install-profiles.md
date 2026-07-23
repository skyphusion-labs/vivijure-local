# Install profiles

vivijure-local is one codebase with **compose profiles** and **env vars** that select which
modules and storage backends are active. The default stack is the **homelab minimal path** (Conrad
ruling 2026-07-22): nine modules plus CPU assemble/master/subtitle, MinIO, no optional finish GPU or cloud
i2v sidecars.

## Modular opt-in principle

Modules are **opt-in** at the compose/env layer: unset `MODULE_*_URL` means the module is not in
the registry and the orchestrator skips its hook entirely. If a module **is** registered (URL set)
but its backend is missing or misconfigured, the shot **fails honestly** (`ok: false`); finish
handlers never fake a step with passthrough output when creds or GPU dispatch are unavailable.

Default homelab/minimal panel: no finish GPU module URLs, no `satellites` profile, per-clip finish
chain skipped; CPU `video-finish` assembles raw clips into the film.

## Default (homelab minimal)

```bash
npm run install:studio
docker compose up -d
```

| Module / service | Compose name | `MODULE_*` / CPU URL |
|------------------|--------------|----------------------|
| LLM (plan.enhance) | `module-plan-enhance` | `MODULE_PLANENHANCE_URL` |
| cast.image | `module-cast-image` | `MODULE_CAST_IMAGE_URL` |
| image.generate | `module-image-generate` | `MODULE_IMAGE_GENERATE_URL` |
| keyframe | `module-keyframe` | `MODULE_KEYFRAME_URL` |
| local-gpu (motion) | `module-local-gpu` | `MODULE_LOCAL_GPU_URL` |
| music-upscale (master) | `audio-master` + `module-audio-master` | `AUDIO_MASTER_URL`, `MODULE_AUDIO_MASTER_URL` |
| film.finish (assemble) | `video-finish` | `VIDEO_FINISH_URL` |
| subtitle | `module-subtitle` | `MODULE_SUBTITLE_URL` |
| notify-email | `module-notify-email` | `MODULE_NOTIFY_EMAIL_URL` |

| Piece | Default |
|-------|---------|
| Keyframe | `module-keyframe` mock sidecar (or RunPod when creds set) |
| Motion | `module-local-gpu` mock sidecar (or `LOCAL_BACKEND_URL` GPU door) |
| Finish GPU (lip-sync, upscale) | **not started** (`profiles: [satellites]`; no `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL`) |
| Cloud i2v / dialogue / speech | **not started** (`profiles: [cloud]`; `MODULE_*` unset) |
| Extra CPU media (prep, beat/mix, title cards) | **not started** (`profiles: [media]`) |
| RIFE interpolation | **not supported** on vivijure-local (RunPod / vivijure-cf only) |
| Object store | MinIO (`S3_*` in compose) |
| Planner | `PLANNER_AI_MOCK=true` in compose (set `false` + AI Gateway creds for real planning) |

The minimal path skips the finish GPU chain and assembles raw clips (see exit smoke).

## Profile: `media` (extra CPU media)

Optional portrait prep, beat sync, audio mix, and film title-card polish. Subtitle stays in the
default stack; only title cards are gated here. Enable the profile **and** set the matching URLs
in `.env` (or use a compose override).

```bash
# .env excerpt (in-network hostnames)
IMAGE_PREP_URL=http://image-prep:8000
AUDIO_BEAT_SYNC_URL=http://audio-beat-sync:8000
AUDIO_MIX_URL=http://audio-mix:8000
MODULE_BEAT_SYNC_URL=http://module-beat-sync:9120
MODULE_FILM_TITLES_URL=http://module-film-titles:9130

COMPOSE_PROFILES=media docker compose up -d
```

## Profile: `cloud` (RunPod / cloud modules)

Cloud motion backends, cloud keyframe, dialogue TTS, speech upscale, and score-chain modules.
Requires RunPod and/or AI Gateway creds as appropriate. Set each `MODULE_*_URL` you want registered.

```bash
# .env excerpt -- bind only the modules you need
MODULE_OWN_GPU_URL=http://module-own-gpu:9103
MODULE_SEEDANCE_URL=http://module-seedance:9150
MODULE_CLOUD_KEYFRAME_URL=http://module-cloud-keyframe:9157
MODULE_DIALOGUE_URL=http://module-dialogue-gen:9142
MODULE_SPEECH_UPSCALE_URL=http://module-speech-upscale:9143
# ... other cloud MODULE_* as needed

COMPOSE_PROFILES=cloud docker compose up -d
```

## Profile: `satellites` (finish GPU sidecars, lipsync/upscale only)

Finish modules (lip-sync, upscale) run as HTTP **module sidecars** on the compose network, gated
behind the compose **`satellites`** profile. **RIFE is not supported** on vivijure-local; it runs
only on the RunPod backend worker for vivijure-cf/production.

The studio reaches finish sidecars only when `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL` are set;
where GPU work runs depends on `FINISH_BACKEND` (see [FINISH_BACKEND.md](FINISH_BACKEND.md)):

| `FINISH_BACKEND` | GPU execution |
|------------------|---------------|
| `local` (homelab default after local#180) | `LOCAL_FINISH_LIPSYNC_URL` / `LOCAL_FINISH_UPSCALE_URL` on your GPU box |
| `runpod` (escape hatch) | RunPod serverless via `*_RUNPOD_ENDPOINT_ID` |

```bash
# In .env (studio reads these when set)
MODULE_LIPSYNC_URL=http://module-finish-lipsync:9111
MODULE_UPSCALE_URL=http://module-finish-upscale:9112
# Post local#180:
# FINISH_BACKEND=local
# LOCAL_FINISH_LIPSYNC_URL=http://finish-lipsync:8011
# LOCAL_FINISH_UPSCALE_URL=http://finish-upscale:8012

COMPOSE_PROFILES=satellites docker compose up -d
```

Without the `MODULE_*` URLs, the studio ignores those modules even if the containers run.
Misconfigured finish sidecars (RunPod creds missing, `LOCAL_FINISH_*_URL` unset in local mode)
fail the shot; they do not passthrough.

## Profile: `full` (legacy alias)

Some fleet overlays refer to `COMPOSE_PROFILES=full` as shorthand for enabling all optional module
profiles. Equivalent to:

```bash
COMPOSE_PROFILES=media,cloud,satellites docker compose up -d
```

(with the corresponding `MODULE_*` and CPU service URLs set in `.env`).

## Profile: own GPU (host motion backend)

Point motion at a real backend on the host (or another machine reachable from Docker):

```bash
# .env or compose override
LOCAL_BACKEND_URL=https://gpu.example.com
LOCAL_BACKEND_TOKEN=...
```

Unset or stop `module-local-gpu` if you run the backend on the host only. The mock sidecar
is safe to leave running; the URL wins at discovery time.

For **RunPod `own-gpu`** or cloud i2v modules, enable `COMPOSE_PROFILES=cloud` and set the matching
`MODULE_<NAME>_URL` to the module worker's HTTP base (same pattern as vivijure-cf `MODULE_*`
bindings).

## Storage: MinIO vs filesystem

| Mode | Config | Use |
|------|--------|-----|
| **MinIO (default)** | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Docker compose, homelab |
| **Filesystem** | Unset all `S3_*`; set `ARTIFACT_ROOT=./data/artifacts` | Local vitest, bare dev without MinIO |
| **Cloud R2** | `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, R2 keys | Optional; same code path as MinIO |

`createStorage()` in `src/platform/create-storage.ts` picks S3 when `S3_*` is complete, else
filesystem. `GET /health` reports `storage: "s3"` or `"filesystem"`.

When the studio runs in Docker but presigned URLs must be fetched from off-box GPUs or RunPod,
expose MinIO with the Caddy edge and set `S3_PRESIGN_ENDPOINT` to the public HTTPS URL. See
[EDGE.md](EDGE.md).

## Verify

```bash
curl -fsS http://127.0.0.1:8790/health
# {"ok":true,"service":"vivijure-studio","phase":2,"storage":"s3"}

curl -fsS -H "Authorization: Bearer $STUDIO_API_TOKEN" http://127.0.0.1:8790/api/modules | jq '.modules[].name'
```

Default minimal install should list nine modules: `plan-enhance`, `cast-image`, `image-generate`,
`keyframe`, `local-gpu`, `audio-master`, `subtitle`, `notify-email`, plus CPU `video-finish` wired
directly (not a module sidecar).
