#!/usr/bin/env bash
# Sync CPU media container build contexts from vivijure-cf.
#
# DESTRUCTIVE: rsync --delete, EXCEPT for the paths listed in scripts/containers-local-divergence.txt.
# That list is the one scope both this script and scripts/check-containers-drift.sh read (local#489):
# a listed path is never written or deleted here, so an intentional local delta survives a sync and
# needs no restore step. containers/README.md is listed too, but this loop never reaches it anyway:
# it syncs the five subdirectories, never containers/ itself.
#
# After a sync, run `npm run containers:check`. audio-beat-sync is not a local pin: it takes the cf
# Dockerfile (python 3.12, librosa 1.0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${VIVIJURE_SRC:-$ROOT/../vivijure-cf}"
DEST="$ROOT/containers"
LIST="$ROOT/scripts/containers-local-divergence.txt"
if [[ ! -d "$UP/containers/video-finish" ]]; then
  echo "upstream containers not found: $UP/containers" >&2
  exit 1
fi
# Fail closed: with no list, an unguarded rsync --delete would overwrite every local delta.
if [[ ! -f "$LIST" ]]; then
  echo "sync-containers: missing $LIST; refusing to sync without the divergence list" >&2
  exit 2
fi
LISTED=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [[ -n "$line" ]] && LISTED+=("$line")
done < "$LIST"

for d in video-finish image-prep audio-beat-sync audio-mix audio-master; do
  excludes=()
  for rel in ${LISTED[@]+"${LISTED[@]}"}; do
    # Anchored to the transfer root, so "video-finish/Dockerfile" protects only that file. An
    # excluded path is neither copied nor deleted by --delete (no --delete-excluded).
    if [[ "$rel" == "$d/"* ]]; then
      excludes+=("--exclude=/${rel#"$d/"}")
    fi
  done
  rsync -a --delete ${excludes[@]+"${excludes[@]}"} "$UP/containers/$d/" "$DEST/$d/"
  echo "synced $d${excludes[*]:+ (kept local: ${excludes[*]//--exclude=\//})}"
done
echo "sync-containers: done. Listed local deltas were not touched. Next: npm run containers:check"
