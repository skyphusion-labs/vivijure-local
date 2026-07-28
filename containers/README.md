# Container build contexts for vivijure-local.
#
# CPU media (image-prep, audio-*, video-finish): synced from vivijure-cf via
# `npm run sync-containers` (canonical source: ../vivijure-cf/containers/).
#
# Local-only (not synced from CF):
#   cast-image/ -- Apache FLUX.2 Klein 4B for cast.image (local#269); compose profile cast-image
#
# Services are defined in the repo-root compose.yaml (no cloudflared / Workers VPC).
