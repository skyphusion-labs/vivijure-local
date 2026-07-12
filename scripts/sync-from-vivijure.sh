#!/usr/bin/env bash
# Copy port candidates from upstream vivijure into this repo for Option B adaptation.
# Does NOT overwrite existing files. Review diffs before committing.
set -euo pipefail

UP="${VIVIJURE_SRC:-$HOME/Documents/GitHub/vivijure}"
DEST="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$UP/src" ]]; then
  echo "upstream not found: $UP" >&2
  exit 1
fi

copy_if_missing() {
  local rel="$1"
  if [[ -e "$DEST/$rel" ]]; then
    echo "skip (exists): $rel"
  else
    mkdir -p "$(dirname "$DEST/$rel")"
    cp -R "$UP/$rel" "$DEST/$rel"
    echo "copied: $rel"
  fi
}

echo "sync from $UP -> $DEST"

# Verbatim copies
copy_if_missing "public"
copy_if_missing "migrations"
copy_if_missing "src/modules/types.ts"

# Port batches (create parent dirs; force-copy into staging for manual merge)
STAGE="$DEST/.sync-staging/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$STAGE"
for batch in \
  "src/modules/registry.ts" \
  "src/modules/conformance.ts" \
  "src/film-orchestrator.ts" \
  "src/film-model.ts" \
  "src/film-render-bridge.ts" \
  "src/render-orchestrator.ts" \
  "src/auth-gate.ts" \
  "src/r2-presign.ts" \
  "src/renders-db.ts" \
  "src/cast-db.ts" \
  "src/storyboard-projects-db.ts"
do
  if [[ -f "$UP/$batch" ]]; then
    mkdir -p "$STAGE/$(dirname "$batch")"
    cp "$UP/$batch" "$STAGE/$batch"
    echo "staged: $batch"
  fi
done

echo "done. staged files in $STAGE (merge manually into src/ with platform adapters)"
