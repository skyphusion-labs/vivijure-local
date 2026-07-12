# Install profiles

vivijure-local is one codebase with **compose profiles** and **env vars** that select which
modules and storage backends are active. The default stack is the **demo path**: mocks for
GPU modules, MinIO for artifacts, no optional finish satellites.

## Default (demo)

```bash
npm run install:studio
docker compose up -d --build
```

| Piece | Default |
|-------|---------|
| Keyframe | `module-keyframe` mock sidecar |
| Motion | `module-local-gpu` mock sidecar |
| Finish GPU (RIFE, lip-sync) | **not started** (no `MODULE_FINISH_*` URLs) |
| Object store | MinIO (`S3_*` in compose) |
| Planner | `PLANNER_AI_MOCK=true` in compose |

The demo path skips the finish GPU chain and assembles raw clips (see exit smoke).

## Profile: `satellites` (finish GPU sidecars)

Manifest-only finish modules (RIFE, lip-sync) run as HTTP sidecars. They do not execute GPU
work in alpha; they prove discovery, routing, and conformance wiring.

```bash
# In .env (studio reads these when set)
MODULE_FINISH_RIFE_URL=http://module-finish-rife:9110
MODULE_FINISH_LIPSYNC_URL=http://module-finish-lipsync:9111

docker compose --profile satellites up -d --build
```

Without the env URLs, the studio ignores those modules even if the containers run.

## Profile: own GPU (host motion backend)

Point motion at a real backend on the host (or another machine reachable from Docker):

```bash
# .env or compose override
MODULE_LOCAL_GPU_URL=http://host.docker.internal:9102
```

Unset or stop `module-local-gpu` if you run the backend on the host only. The mock sidecar
is safe to leave running; the URL wins at discovery time.

For **RunPod `own-gpu`** or cloud i2v modules, set the matching `MODULE_<NAME>_URL` to the
module worker's HTTP base (same pattern as upstream vivijure `MODULE_*` bindings). Cloud
modules are optional; alpha CI does not require them.

## Storage: MinIO vs filesystem

| Mode | Config | Use |
|------|--------|-----|
| **MinIO (default)** | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Docker compose, homelab |
| **Filesystem** | Unset all `S3_*`; set `ARTIFACT_ROOT=./data/artifacts` | Local vitest, bare dev without MinIO |
| **Cloud R2** | `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, R2 keys | Optional; same code path as MinIO |

`createStorage()` in `src/platform/create-storage.ts` picks S3 when `S3_*` is complete, else
filesystem. `GET /health` reports `storage: "s3"` or `"filesystem"`.

When the studio runs in Docker but presigned URLs must be fetched from the host GPU process,
set `S3_PRESIGN_ENDPOINT` to a host-reachable MinIO URL (see `.env.example`).

## Verify

```bash
curl -fsS http://127.0.0.1:8790/health
# {"ok":true,"service":"vivijure-studio","phase":2,"storage":"s3"}

curl -fsS -H "Authorization: Bearer $STUDIO_API_TOKEN" http://127.0.0.1:8790/api/modules | jq '.modules[].name'
```
