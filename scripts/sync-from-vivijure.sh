#!/usr/bin/env bash
# Copy / refresh shared surfaces from vivijure-cf into this repo.
#
# public/: force-sync shared files (respects the same LOCAL_PUBLIC_SKIP list as
#   upstream-public-parity.sh). This is the remedy the parity gate names on FAIL.
# Other paths: extraction-era helper -- copy_if_missing only (does not overwrite).
# Staged port batches still land under .sync-staging/ for manual merge.
set -euo pipefail

UP="${VIVIJURE_SRC:-$(cd "$(dirname "$0")/../.." && pwd)/vivijure-cf}"
DEST="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$UP/src" && ! -d "$UP/public" ]]; then
  echo "upstream not found: $UP" >&2
  exit 1
fi

# Keep in lockstep with scripts/upstream-public-parity.sh LOCAL_PUBLIC_SKIP.
LOCAL_PUBLIC_SKIP=(
  public/settings.html
  public/settings-secrets.css
)

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

# Overwrite shared public/ files from upstream; leave local-only overlays alone.
sync_public() {
  if [[ ! -d "$UP/public" ]]; then
    echo "skip public sync: no upstream public/ at $UP" >&2
    return 0
  fi
  mkdir -p "$DEST/public"
  local copied=0 skipped=0
  while IFS= read -r base; do
    [[ -z "$base" ]] && continue
    local_rel="public/$base"
    skip=0
    for s in "${LOCAL_PUBLIC_SKIP[@]}"; do
      [[ "$local_rel" == "$s" ]] && skip=1 && break
    done
    if [[ $skip -eq 1 ]]; then
      echo "skip (local overlay): $local_rel"
      skipped=$((skipped + 1))
      continue
    fi
    mkdir -p "$(dirname "$DEST/$local_rel")"
    cp "$UP/public/$base" "$DEST/$local_rel"
    echo "synced: $local_rel"
    copied=$((copied + 1))
  done < <(cd "$UP/public" && find . -type f | sed 's|^\./||' | sort)
  echo "public sync: wrote $copied file(s), skipped $skipped local overlay(s)"
}

echo "sync from $UP -> $DEST"

sync_public

# Verbatim copies that may still be missing on a fresh clone
copy_if_missing "migrations"
if [[ -f "$UP/src/modules/types.ts" ]]; then
  CORE="${DEST}/../vivijure-core"
  if [[ -d "$CORE/src/modules" ]]; then
    cp "$UP/src/modules/types.ts" "$CORE/src/modules/types.ts"
    echo "copied: src/modules/types.ts -> ../vivijure-core/src/modules/types.ts"
  else
    echo "skip: ../vivijure-core not found (clone sibling repo first)" >&2
  fi
fi

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

echo "done. public/ shared files synced; staged port candidates in $STAGE (merge manually into src/ with platform adapters)"
echo "re-check: bash scripts/upstream-public-parity.sh \"$UP\""
