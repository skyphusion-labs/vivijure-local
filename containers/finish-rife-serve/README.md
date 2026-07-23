# finish-rife-serve (homelab GPU)

Homelab HTTP wrapper for `finish_clip` (RIFE interpolation + face restore). This is **local-panel
infrastructure**: it consumes the published `vivijure-backend` RunPod image as a GPU base and adds
a RunPod-compatible `/run` + `/status/{id}` API for `LOCAL_FINISH_RIFE_URL`.

Do **not** add serve mode to `vivijure-backend` for this path. MuseTalk and upscale keep serve
overlays in their own repos; RIFE lives here because `finish_clip` is implemented in the backend
handler but homelab wiring is owned by vivijure-local.

## Build

```bash
docker build \
  --build-arg BACKEND_IMAGE=ghcr.io/skyphusion-labs/vivijure-backend:1.0.6 \
  -t ghcr.io/skyphusion-labs/vivijure-local-finish-rife:1.1.13 \
  containers/finish-rife-serve
```

Published on vivijure-local release tags as `ghcr.io/skyphusion-labs/vivijure-local-finish-rife:X.Y.Z`.

## Wire-up

Set on propagandhi (see `fleet-chezmoi/system/stacks/propagandhi/vivijure-finish-gpu/`):

- `LOCAL_FINISH_RIFE_URL=http://finish-rife:8010`
- `LOCAL_FINISH_TOKEN` (same value in studio `.env` and finish-gpu stack `.env`)
