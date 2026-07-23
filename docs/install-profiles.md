# Install profiles

vivijure-local is one codebase with **compose profiles** and **env vars** that select which
modules and storage backends are active. The default stack is **all CPU modules + homelab motion**
(Conrad ruling 2026-07-22): every CPU sidecar and VPC shim runs without a profile; only RunPod/cloud
GPU modules are gated behind `cloud` or `satellites`.

## Modular opt-in principle

Modules are **opt-in** at the compose/env layer: unset `MODULE_*_URL` means the module is not in
the registry and the orchestrator skips its hook entirely. If a module **is** registered (URL set)
but its backend is missing or misconfigured, the shot **fails honestly** (`ok: false`); finish
handlers never fake a step with passthrough output when creds or GPU dispatch are unavailable.

Default homelab: all CPU module URLs wired in compose; finish GPU and cloud i2v URLs left empty
until you opt in with profiles + `.env`. **Wan cast LoRA train is not homelab-scoped:** do not set
`RUNPOD_WAN_TRAIN_ENDPOINT_ID`; local `/train-lora` uses SDXL on the render endpoint (train on CF
prod for Wan).

## Default (homelab)

```bash
npm run install:studio
docker compose up -d
```

### Module sidecars (default)

| Module | Compose name | `MODULE_*` URL (compose default) |
|--------|--------------|----------------------------------|
| LLM (plan.enhance) | `module-plan-enhance` | `MODULE_PLANENHANCE_URL` |
| cast.image | `module-cast-image` | `MODULE_CAST_IMAGE_URL` |
| image.generate | `module-image-generate` | `MODULE_IMAGE_GENERATE_URL` |
| keyframe | `module-keyframe` | `MODULE_KEYFRAME_URL` |
| local-gpu (motion) | `module-local-gpu` | `MODULE_LOCAL_GPU_URL` |
| music-upscale (master) | `module-audio-master` | `MODULE_AUDIO_MASTER_URL` |
| subtitle | `module-subtitle` | `MODULE_SUBTITLE_URL` |
| notify-email | `module-notify-email` | `MODULE_NOTIFY_EMAIL_URL` |
| beat-sync | `module-beat-sync` | `MODULE_BEAT_SYNC_URL` |
| film-titles | `module-film-titles` | `MODULE_FILM_TITLES_URL` |
| dialogue-gen | `module-dialogue-gen` | `MODULE_DIALOGUE_URL` |
| music-gen | `module-music-gen` | `MODULE_MUSIC_GEN_URL` |

### CPU VPC shims (default)

| Service | Port | Studio env |
|---------|------|------------|
| film.finish (assemble) | 8780 | `VIDEO_FINISH_URL` |
| image-prep | 8781 | `IMAGE_PREP_URL` |
| audio-beat-sync | 8782 | `AUDIO_BEAT_SYNC_URL` |
| audio-mix | 8783 | `AUDIO_MIX_URL` |
| music-upscale (audio-master) | 8784 | `AUDIO_MASTER_URL` |

| Piece | Default |
|-------|---------|
| Keyframe | `module-keyframe` mock sidecar (or RunPod when creds set) |
| Motion | `module-local-gpu` mock sidecar (or `LOCAL_BACKEND_URL` GPU door) |
| Dialogue / music-gen | AI Gateway sidecars (mock/offline when gateway creds unset) |
| speech-upscale | **not started** (`profiles: [cloud]`; `MODULE_SPEECH_UPSCALE_URL` unset) |
| Finish GPU (lip-sync, upscale) | **not started** (`profiles: [satellites]`; no `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL`) |
| Cloud i2v / own-gpu / narration-gen | **not started** (`profiles: [cloud]`; `MODULE_*` unset) |
| RIFE interpolation | **not supported** on vivijure-local (RunPod / vivijure-cf only) |
| Object store | MinIO (`S3_*` in compose) |
| Planner | `PLANNER_AI_MOCK=true` in compose (set `false` + AI Gateway creds for real planning) |

Without finish GPU sidecars, the default path assembles raw clips via CPU `video-finish` (see exit smoke).

## Profile: `cloud` (RunPod / cloud GPU modules)

Cloud motion backends, cloud keyframe, narration-gen (RunPod), and all cloud i2v providers.
Requires RunPod and/or AI Gateway creds as appropriate. Set each `MODULE_*_URL` you want registered.

```bash
# .env excerpt -- bind only the modules you need
MODULE_OWN_GPU_URL=http://module-own-gpu:9103
MODULE_SEEDANCE_URL=http://module-seedance:9150
MODULE_CLOUD_KEYFRAME_URL=http://module-cloud-keyframe:9157
MODULE_NARRATION_GEN_URL=http://module-narration-gen:9159
MODULE_SPEECH_UPSCALE_URL=http://module-speech-upscale:9143
# ... other cloud MODULE_* as needed

COMPOSE_PROFILES=cloud docker compose up -d
```

**Not in default (cloud profile only):** `own-gpu`, cloud i2v (`seedance`, `kling`, `google-veo`,
`minimax-hailuo`, `vidu-q3`, `alibaba-wan`, `alibaba-wan-lora`), `cloud-keyframe`, `narration-gen`,
`speech-upscale` (RunPod `vivijure-audio-upscale` via `AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID`).

Music mastering stays on the default CPU path: `audio-master` (VPC shim, port 8784) and
`module-audio-master` (`MODULE_AUDIO_MASTER_URL`). Do not confuse that chain with `speech-upscale`,
which polishes dialogue audio on RunPod only.

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
COMPOSE_PROFILES=cloud,satellites docker compose up -d
```

(with the corresponding cloud `MODULE_*` URLs set in `.env`).

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

Default install should list thirteen module sidecars: `plan-enhance`, `cast-image`, `image-generate`,
`keyframe`, `local-gpu`, `audio-master`, `subtitle`, `notify-email`, `beat-sync`, `film-titles`,
`dialogue-gen`, `music-gen`, plus CPU `video-finish` wired directly (not a module sidecar).
