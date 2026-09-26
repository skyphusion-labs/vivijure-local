# CPU media container build contexts (synced from vivijure-cf).
#
# Canonical source: ../vivijure-cf/containers/
# Sync:   npm run sync-containers
# Check:  npm run containers:check   (CI: .github/workflows/containers-drift.yml, local#314)
#
# Services are defined in the repo-root compose.yaml (no cloudflared / Workers VPC).
#
# Intentional deltas vs cf (allowlisted + pin-tested in scripts/check-containers-drift.sh):
#   README.md                         -- this file (local host docs)
#   video-finish/Dockerfile           -- python 3.11 on BOTH sides (cf parity, local#316);
#                                        allowlisted for local's longer comment block only
#   image-prep/Dockerfile             -- numba pin 3.11; local dependabot comments
#   audio-beat-sync/Dockerfile        -- same as image-prep
# Everything else under the five service dirs must match cf byte-for-byte.
