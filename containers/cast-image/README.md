# cast-image

Local sidecar for Apache-2.0 FLUX.2 Klein 4B. It is not a vivijure-cf mirror, and
`scripts/check-containers-drift.sh` does not include this directory.

`model_allowlist.py` mirrors `src/modules/chain/cast-image-model-policy.ts`.
The only allowlisted id is `black-forest-labs/FLUX.2-klein-4B`, and the loader
passes revision `e7b7dc27f91deacad38e78976d1f2b499d76a294` to `from_pretrained`.
Any other id is refused, including ids that miss the named non-commercial list.

CI runs `python3 containers/cast-image/test_allowlist.py`. That file has no
torch dependency. `test_app.py` is the HTTP suite and needs aiohttp, pillow,
and pytest; it is not part of `npm test`.

The image is not built in CI; `compose.yaml` builds it locally under the
`cast-image` profile.

The panel calls this sidecar when `CAST_IMAGE_BACKEND_URL` is set (local#269).
It unloads Ollama before each `/generate` and calls `/unload` after the last
reference image, so the card is only held while a cast job is running. The
panel sends the allowlisted repo id explicitly and refuses a response whose
`revision` is not the pinned one, so this container's own refusal is a second
independent check rather than the only one.
