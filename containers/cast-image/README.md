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

The image is not built in CI. The panel does not call this sidecar yet.
