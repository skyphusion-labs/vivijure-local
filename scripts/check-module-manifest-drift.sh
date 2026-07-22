#!/usr/bin/env bash
# Fail when committed dev/manifests/*.json drift from vivijure-cf module MANIFESTs.
#
# Regenerates into a temp dir via scripts/sync-module-manifests.ts, then diffs against
# the committed fixtures. Excludes bare-planner.json (deliberate enum-less fixture for
# gate / e2e; not produced by the sync script).
#
#   bash scripts/check-module-manifest-drift.sh [vivijure-cf-clone]
#   VIVIJURE_SRC=/path/to/vivijure-cf bash scripts/check-module-manifest-drift.sh
#
# Ride the upstream-parity CI job (already checks out cf main).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${1:-${VIVIJURE_SRC:-$ROOT/../vivijure-cf}}"

if [[ ! -d "$UP/modules" ]]; then
  echo "check-module-manifest-drift: no vivijure-cf modules/ at: $UP" >&2
  echo "check-module-manifest-drift: clone skyphusion-labs/vivijure-cf beside this repo, or set VIVIJURE_SRC, or pass the path" >&2
  exit 2
fi

if [[ ! -d "$ROOT/dev/manifests" ]]; then
  echo "check-module-manifest-drift: missing $ROOT/dev/manifests" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "check-module-manifest-drift: regenerating from $UP -> $TMP"
# Prefer repo-local tsx when node_modules is present; else npx.
if [[ -x "$ROOT/node_modules/.bin/tsx" ]]; then
  MANIFESTS_OUT="$TMP" VIVIJURE_SRC="$UP" "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sync-module-manifests.ts"
else
  MANIFESTS_OUT="$TMP" VIVIJURE_SRC="$UP" npx --yes tsx "$ROOT/scripts/sync-module-manifests.ts"
fi

EXCLUDE="bare-planner.json"
drift=()

# Committed fixtures (except the deliberate bare-planner) must match regen.
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  [[ "$base" == "$EXCLUDE" ]] && continue
  if [[ ! -f "$TMP/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT committed $base has no regenerated counterpart (module removed from sync list?)" >&2
    drift+=("$base (orphan)")
    continue
  fi
  if ! diff -q "$ROOT/dev/manifests/$base" "$TMP/$base" >/dev/null 2>&1; then
    echo "check-module-manifest-drift: DRIFT $base" >&2
    diff -u "$ROOT/dev/manifests/$base" "$TMP/$base" 2>&1 | head -80 >&2 || true
    drift+=("$base")
  fi
done < <(cd "$ROOT/dev/manifests" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

# Regenerated modules must be committed (except we never emit bare-planner).
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  if [[ ! -f "$ROOT/dev/manifests/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT regenerated $base missing from committed dev/manifests/" >&2
    drift+=("$base (missing)")
  fi
done < <(cd "$TMP" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

if [[ ${#drift[@]} -gt 0 ]]; then
  echo "check-module-manifest-drift: FAIL -- ${#drift[@]} drifting manifest(s): ${drift[*]}" >&2
  echo "check-module-manifest-drift: fix with: VIVIJURE_SRC=$UP npm run module-manifests && git add dev/manifests && commit" >&2
  exit 1
fi

echo "check-module-manifest-drift: PASS (dev/manifests match vivijure-cf; excluded $EXCLUDE)"
