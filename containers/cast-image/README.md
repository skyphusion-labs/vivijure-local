# cast-image (local FLUX.2 Klein 4B)

Apache-2.0 **cast.image** backend for vivijure-local ([#269](https://github.com/skyphusion-labs/vivijure-local/issues/269)).

Generates LoRA training-set PNGs from portrait + optional source refs. Output keys stay
`cast-gen/<cast_id>/ref_XX.png` for the existing cast-prep / train path.

## Model

| Id | License | Notes |
|----|---------|--------|
| `black-forest-labs/FLUX.2-klein-4B` | Apache-2.0 | Homelab default (~13GB VRAM; 16GB door) |
| klein-9b | **Non-commercial** | Not used here |

## Run (homelab NVIDIA)

```bash
# from vivijure-local root
docker compose --profile cast-image build cast-image
COMPOSE_PROFILES=cast-image docker compose \
  -f compose.yaml -f compose.cast-image-nvidia.yaml up -d cast-image module-cast-image

# .env
CAST_IMAGE_BACKEND_URL=http://cast-image:8785
# host-native studio:
# CAST_IMAGE_BACKEND_URL=http://127.0.0.1:8785
```

Then `npm run sync:secrets:compose` and recreate `module-cast-image` so the sidecar sees the URL.

## API

| Method | Path | Body / response |
|--------|------|-----------------|
| GET | `/health` | `{ ok, configured, cuda, model, loaded }` — `configured` is false without CUDA |
| POST | `/generate` | `{ prompt, width?, height?, ref_images?: [b64] }` → `{ image, mime }` |
| POST | `/unload` | `{ ok }` — free VRAM before Ollama / local-gpu |

## Sequential VRAM

On one 16GB card: **cast.image → unload → Ollama plan.enhance → unload → local-gpu**.
The studio module calls `/unload` when a cast.image job finishes, and unloads Ollama before
each local generate.

## Train half

This ships image refs only. Local SDXL `train_lora` on the 16GB door is [#271](https://github.com/skyphusion-labs/vivijure-local/issues/271).
