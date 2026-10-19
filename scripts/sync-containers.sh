#!/usr/bin/env bash
# Sync CPU media container build contexts from vivijure-cf.
#
# DESTRUCTIVE: rsync --delete. After sync, restore intentional local comment blocks
# (video-finish and image-prep stay python 3.11; containers/README.md) and run
# `npm run containers:check` (local#314 CI gate). audio-beat-sync is not a local pin:
# leave the cf Dockerfile in place (python 3.12, librosa 1.0).
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
