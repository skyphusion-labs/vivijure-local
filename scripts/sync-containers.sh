#!/usr/bin/env bash
# Sync CPU media container build contexts from vivijure-cf.
#
# DESTRUCTIVE: rsync --delete. After sync, restore intentional local pins (video-finish
# python 3.14; image-prep/audio-beat-sync 3.11 comments; containers/README.md) and run
# `npm run containers:check` (local#314 CI gate).
set -euo pipefail
UP="${VIVIJURE_SRC:-$(cd "$(dirname "$0")/../.." && pwd)/vivijure-cf}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/containers"
if [[ ! -d "$UP/containers/video-finish" ]]; then
  echo "upstream containers not found: $UP/containers" >&2
  exit 1
fi
for d in video-finish image-prep audio-beat-sync audio-mix audio-master; do
  rsync -a --delete "$UP/containers/$d/" "$DEST/$d/"
  echo "synced $d"
done
echo "sync-containers: done. Restore intentional Dockerfile pins + README if rsync overwrote them, then: npm run containers:check"
