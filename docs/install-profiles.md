# Install profiles

vivijure-local is one codebase with **compose profiles** and **env vars** that select which
modules and storage backends are active. The default stack is **Ollama plan.enhance + local-gpu
(16GB door first) + all CPU modules** (Conrad ruling 2026-07-28 / local#265): no RunPod modules in
the default path. RunPod/cloud GPU modules stay behind `cloud` or `satellites`.

## Modular opt-in principle

Modules are **opt-in** at the compose/env layer: unset `MODULE_*_URL` means the module is not in
the registry and the orchestrator skips its hook entirely. If a module **is** registered (URL set)
but its backend is missing or misconfigured, the shot **fails honestly** (`ok: false`); finish
handlers never fake a step with passthrough output when creds or GPU dispatch are unavailable.

Default homelab: all CPU module URLs wired in compose; finish GPU and cloud i2v URLs left empty
until you opt in with profiles + `.env`. **Wan cast LoRA train is not homelab-scoped:** do not set
`RUNPOD_WAN_TRAIN_ENDPOINT_ID`. **SDXL cast train** (`POST /api/cast/:id/train-lora`) prefers
`LOCAL_BACKEND_URL` (the 12gb/16gb door's `action: train_lora`) when the door is wired; falls back
to `RUNPOD_ENDPOINT_ID` only if you opt into a cloud render EP.

## Default (homelab)

```bash
npm run install:studio
docker compose up -d
```

### Module sidecars (default)

| Module | Compose name | `MODULE_*` URL (compose default) |
|--------|--------------|----------------------------------|
| LLM (plan.enhance via Ollama) | `module-plan-enhance` | `MODULE_PLANENHANCE_URL` |
| cast.image | `module-cast-image` | `MODULE_CAST_IMAGE_URL` |
| image.generate | `module-image-generate` | `MODULE_IMAGE_GENERATE_URL` |
| music-upscale (master) | `module-audio-master` | `MODULE_AUDIO_MASTER_URL` |
| subtitle | `module-subtitle` | `MODULE_SUBTITLE_URL` |
| notify-email | `module-notify-email` | `MODULE_NOTIFY_EMAIL_URL` |
| beat-sync | `module-beat-sync` | `MODULE_BEAT_SYNC_URL` |
| film-titles | `module-film-titles` | `MODULE_FILM_TITLES_URL` |
| dialogue-gen | `module-dialogue-gen` | `MODULE_DIALOGUE_URL` |
| music-gen | `module-music-gen` | `MODULE_MUSIC_GEN_URL` |

Also started (not a module sidecar): **`ollama`** (+ one-shot `ollama-pull` for
`OLLAMA_PLAN_MODEL`, default `qwen3:14b`). NVIDIA GPU overlay: `compose.ollama-nvidia.yaml`.

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
| Planner | Ollama (`OLLAMA_BASE_URL` + `OLLAMA_PLAN_MODEL=qwen3:14b`); unload before keyframe |
| cast.image (training refs) | Workers AI. Set `CAST_IMAGE_BACKEND_URL` + `cast-image` profile for Apache-2.0 Klein 4B on your own card (local#269) |
| Keyframe + motion | `module-local-gpu`, **`localgpu` profile only** (16GB door). No door: the service is **not in the stack**, and the host reports both hooks unavailable -- no mock, no doorless stand-in (local#229, local#280) |
| Dialogue / music-gen | AI Gateway sidecars (honest degrade when gateway creds unset) |
| RunPod keyframe | **not started** (`profiles: [cloud]`; `MODULE_KEYFRAME_URL` unset) |
| speech-upscale | **not started** (`profiles: [cloud, satellites]`; `MODULE_SPEECH_UPSCALE_URL` unset) |
| Finish GPU (lip-sync, upscale) | **not started** (`profiles: [satellites]`; no `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL`) |
| Cloud i2v / own-gpu | **not started** (`profiles: [cloud]`; `MODULE_*` unset) |
| RIFE interpolation | **not supported** on vivijure-local (RunPod / vivijure-cf only) |
| Object store | MinIO (`S3_*` in compose) |
| Offline planner | `PLANNER_AI_MOCK=true` (CI / no model pull); compose default is `false` + Ollama |

First-win film path: **Ollama plan.enhance → unload → local-gpu keyframe on the 16GB door → CPU
assemble**. Without finish GPU sidecars, clips assemble via CPU `video-finish` (see exit smoke).

## Profile: `localgpu` (your own GPU door)

The keyframe + motion engine. Opt-in, like every other lane -- and with the lane off, `module-local-gpu`
is **not in the stack at all** (local#280): nothing to hide, nothing to refuse, no process reporting
its own absence. The studio then reports `keyframe` / `motion.backend` unavailable on
`GET /api/modules` with the knob named.

You set **one** thing. `npm run install:studio` derives the rest into `.env`:

```bash
# .env -- the only line you write
LOCAL_BACKEND_URL=http://vivijure-local-16gb:8000   # or -12gb, or http://host.docker.internal:8000
# LOCAL_BACKEND_TOKEN=...                           # if your door requires a bearer

npm run install:studio    # adds `localgpu` to COMPOSE_PROFILES, sets MODULE_LOCAL_GPU_URL
docker compose up -d      # compose reads .env, so plain `up` sees the lane too
```

Clearing `LOCAL_BACKEND_URL` and re-running `install:studio` removes the lane again. The derivation
runs both ways on purpose: a stale `localgpu` profile with no door address would otherwise block
startup on a variable you already deleted.

If you enable the profile by hand and leave the door address empty, `localgpu-door-gate` fails the lane
at startup rather than bringing up a sidecar pointed at nothing.

## Profile: `cast-image` (cast references on your own card)

`cast.image` generates the 4-10 training references a cast LoRA is trained on. By default it runs
on Workers AI. Set `CAST_IMAGE_BACKEND_URL` and it runs on your own card instead, on Apache-2.0
**FLUX.2 Klein 4B** at a pinned revision (local#269, under epic local#200: Cloudflare and RunPod
are deliberate opt-ins, never defaults a user discovers they are already on).

Needs roughly **13GB VRAM**. Its own profile, not folded into `localgpu`, because the two are
separately useful: you can run the GPU door for keyframes and still generate references in the
cloud, or the reverse.

```bash
docker compose --profile cast-image build cast-image        # CUDA image, not baked in CI

# .env
CAST_IMAGE_BACKEND_URL=http://cast-image:8785
# CAST_IMAGE_TOKEN=...            # optional bearer, must match the sidecar

COMPOSE_PROFILES=cast-image docker compose \
  -f compose.yaml -f compose.cast-image-nvidia.yaml up -d cast-image
npm run sync:secrets:compose
docker compose up -d --force-recreate module-cast-image
```

**Setting the URL takes cast references off Cloudflare entirely.** Presence wins over the Workers
AI catalog, and an unusable or unreachable door **fails loudly naming the door** rather than
falling back to the cloud. Three reasons the fall-through would be wrong, and they are worth
knowing before someone "fixes" it:

1. Writing the variable IS the operator asking for the local card. Reading a typo as "unset" would
   put the job on the exact cloud dependency this lane removes, silently, looking like success.
2. The cloud default is `@cf/black-forest-labs/flux-2-klein-9b`, and `cast.image` exists to produce
   **training** data. ernst's licence read on local#269 found BFL ToS 1.3(n) prohibits using Output
   to train or fine-tune other models. vivijure-cf#751 settled the Cloudflare path for inference;
   a silent failure-path switch into it for training data is not a decision the code may take.
3. A homelabber running this door usually has no Cloudflare credentials at all, so the "fallback"
   is an obscure auth error several layers down instead of a sentence naming the door.

Unlike `speech-upscale`, there is **no honest-degrade shape** here. Cast prep is not a polish step:
a miss means there is no training image, and training a LoRA on a short set is worse than a stopped
job. So failures are `ok: false`, loud, and named.

**The run records `model:local/flux-2-klein-4b`**, never a `@cf/` id the box never called, even
when the panel's model picker sent one. The picker still projects the cloud catalog from
`dev/manifests/cast-image.json`; with a door wired the module replaces that choice rather than
honouring it. The manifest enum is deliberately **not** given a `local/...` entry, because a
selectable option that means nothing without a door is worse than no option.

**Sequential VRAM** (local#265): the panel unloads Ollama before each `/generate` and calls
`POST /unload` after the last reference image, so cast prep, planning and keyframes take the card
in turn rather than contending for it. Without `compose.cast-image-nvidia.yaml` the sidecar starts
but reports `configured:false`, and the panel surfaces that as a 503 naming the GPU: the honest
built-but-unusable state, not a silent CPU fallback.

Weights land in the `cast-image-models` named volume, so a `--force-recreate` does not re-download
several GB.

**Still RunPod/CF for now:** training the LoRA itself. Local SDXL `train_lora` is
[local#271](https://github.com/skyphusion-labs/vivijure-local/issues/271); Apache references
without a local train step still leave the adapter half on RunPod or Cloudflare.

## Profile: `cloud` (RunPod / cloud GPU modules)

RunPod keyframe, own-gpu, cloud i2v providers, cloud-keyframe, speech-upscale. Requires RunPod
and/or AI Gateway creds as appropriate. Set each `MODULE_*_URL` you want registered.

```bash
# .env excerpt -- bind only the modules you need
MODULE_KEYFRAME_URL=http://module-keyframe:9101
MODULE_OWN_GPU_URL=http://module-own-gpu:9103
MODULE_SEEDANCE_URL=http://module-seedance:9150
MODULE_CLOUD_KEYFRAME_URL=http://module-cloud-keyframe:9157
MODULE_SPEECH_UPSCALE_URL=http://module-speech-upscale:9143
# ... other cloud MODULE_* as needed

COMPOSE_PROFILES=cloud docker compose up -d
```

**Not in default (cloud profile only):** RunPod `keyframe`, `own-gpu`, cloud i2v (`seedance`,
`kling`, `google-veo`, `minimax-hailuo`, `vidu-q3`, `alibaba-wan`, `alibaba-wan-lora`),
`cloud-keyframe`, `speech-upscale` (RunPod `vivijure-audio-upscale`).

Music mastering stays on the default CPU path: `audio-master` (VPC shim, port 8784) and
`module-audio-master` (`MODULE_AUDIO_MASTER_URL`). Do not confuse that chain with `speech-upscale`,
which polishes dialogue audio. `speech-upscale` is **no longer RunPod-only** (local#383): set
`LOCAL_FINISH_SPEECH_URL` and it runs on your own box instead, with no fallback to RunPod. Its
sidecar is startable from the `satellites` lane as well as `cloud`.

## Profile: `satellites` (finish GPU sidecars, lipsync/upscale only)

Finish modules (lip-sync, upscale) run as HTTP **module sidecars** on the compose network, gated
behind the compose **`satellites`** profile. **RIFE is not supported** on vivijure-local; it runs
only on the RunPod backend worker for vivijure-cf/production.

The studio reaches finish sidecars only when `MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL` are set;
where GPU work runs depends on `FINISH_BACKEND` (see [FINISH_BACKEND.md](FINISH_BACKEND.md)):

| `FINISH_BACKEND` | GPU execution |
|------------------|---------------|
| `local` (**the default**, local#229) | `LOCAL_FINISH_LIPSYNC_URL` / `LOCAL_FINISH_UPSCALE_URL` on your GPU box; refuses by name when unset |
| `runpod` (explicit opt-in) | RunPod serverless via `*_RUNPOD_ENDPOINT_ID` |

```bash
# In .env (studio reads these when set)
MODULE_LIPSYNC_URL=http://module-finish-lipsync:9111
MODULE_UPSCALE_URL=http://module-finish-upscale:9112
# FINISH_BACKEND defaults to local; set these or the sidecars refuse by name:
# LOCAL_FINISH_LIPSYNC_URL=http://finish-lipsync:8011
# LOCAL_FINISH_UPSCALE_URL=http://finish-upscale:8012

# local#383: speech-upscale on your own box too. Comma-separate for several cards. Setting this
# takes speech audio off RunPod entirely -- it wins over AUDIO_UPSCALE_RUNPOD_ENDPOINT_ID and never
# falls back. Its sidecar starts in this lane as well as `cloud`.
# MODULE_SPEECH_UPSCALE_URL=http://module-speech-upscale:9143
# LOCAL_FINISH_SPEECH_URL=http://speech-upscale:8013

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

Point motion at a real backend on the host (or another machine reachable from Docker): set
`LOCAL_BACKEND_URL=https://gpu.example.com` (plus `LOCAL_BACKEND_TOKEN` if required) and run
`npm run install:studio` -- see the [`localgpu` profile](#profile-localgpu-your-own-gpu-door) above.

To stop using a door, clear `LOCAL_BACKEND_URL` and re-run `install:studio`; the lane goes away rather
than idling. There is no doorless `module-local-gpu` to leave running.

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

Default install should list homelab module sidecars (no RunPod `keyframe`): `plan-enhance`,
`cast-image`, `image-generate`, `local-gpu`, `audio-master`, `subtitle`, `notify-email`, `beat-sync`,
`film-titles`, `dialogue-gen`, `music-gen`, `narration-gen`, plus CPU `video-finish` and `ollama`.
